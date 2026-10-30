import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPluginArtifact,
  getInstalledPluginRegistration,
  getPluginKvValue,
  getPluginSettingsValues,
  listPluginArtifacts,
  listPluginSchedules,
  upsertInstalledPlugin,
  type DbConnection,
  type InstalledPluginRow,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { registerPluginRoutes } from "../../../src/routes/plugins.js";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import { createPluginInstallJobs } from "../../../src/services/plugins/plugin-install-jobs.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { planTrackingRangeChange } from "../../../src/services/plugins/plugin-tracking-range.js";
import { createPluginUpdateJobs } from "../../../src/services/plugins/plugin-update-jobs.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);

type UpsertInstalledPluginInput = Parameters<typeof upsertInstalledPlugin>[1];

const EMPTY_UPDATE_STATE = {
  lastCheckAt: null,
  availableCompatibleVersion: null,
  newestIncompatibleVersion: null,
  statusDetail: null,
};

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

const FIXTURE_SERVER = `
  export default function plugin(bb: any) {
    bb.settings.define({
      apiKey: { type: "string", label: "API key", secret: true },
      team: { type: "string", label: "Team" },
    });
    bb.background.schedule("sync", "0 * * * *", async () => {});
  }
`;

async function release(repo: string, version: string): Promise<string> {
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      name: "bb-plugin-tracked",
      version,
      bb: {
        name: "Tracked fixture",
        description: "Tracking range fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(repo, "server.ts"), FIXTURE_SERVER);
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-qm", version]);
  await git(repo, ["tag", `v${version}`]);
  return git(repo, ["rev-parse", "HEAD"]);
}

describe("planTrackingRangeChange", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => db.$client.close());

  function stored(
    input: Partial<UpsertInstalledPluginInput>,
  ): InstalledPluginRow {
    upsertInstalledPlugin(db, {
      id: "tracked",
      source: "git:/repo@semver:^0.1.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        selector: {
          kind: "range",
          range: "^0.1.0",
          tagPrefix: "",
          resolvedTag: "v0.1.0",
        },
      },
      exactResolution: { kind: "git", commit: "a".repeat(40) },
      updateState: EMPTY_UPDATE_STATE,
      activeArtifactId: null,
      rootDir: "/cache/tracked",
      version: "0.1.0",
      enabled: true,
      enabledFollowsDefault: false,
      ...input,
    });
    const row = getInstalledPluginRegistration(db, input.id ?? "tracked");
    if (row === undefined) throw new Error("fixture row missing");
    return row;
  }

  function storedAt(version: string, range: string): InstalledPluginRow {
    return stored({
      source: `git:/repo@semver:${range}`,
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        selector: {
          kind: "range",
          range,
          tagPrefix: "",
          resolvedTag: `v${version}`,
        },
      },
      version,
    });
  }

  function gitRef(ref: string, refKind: "branch" | "tag" | "commit") {
    return {
      source: `git:/repo@${ref}`,
      sourceIntent: {
        kind: "git" as const,
        url: "/repo",
        subdirectory: null,
        selector: { kind: "ref" as const, ref, refKind },
      },
    };
  }

  function npmRow(
    requestedSpec: string,
    specKind: "default" | "exact" | "tag" | "range",
    activeArtifactId: string | null,
  ): InstalledPluginRow {
    if (activeArtifactId !== null) {
      createPluginArtifact(db, {
        id: activeArtifactId,
        pluginId: "linear",
        sourceKind: "npm",
        npmResolvedVersion: "1.2.3",
        gitResolvedCommit: null,
        gitCheckoutRoot: null,
        path: `/cache/${activeArtifactId}`,
        integrity: "sha512-current",
        contentHash: null,
        validationResult: "valid",
        validatedAt: 1,
      });
    }
    return stored({
      id: "linear",
      source:
        specKind === "default"
          ? "npm:bb-plugin-linear"
          : `npm:bb-plugin-linear@${requestedSpec}`,
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.npmjs.org",
        requestedSpec,
        specKind,
      },
      exactResolution: {
        kind: "npm",
        version: "1.2.3",
        integrity: "sha512-current",
      },
      activeArtifactId,
      version: "1.2.3",
    });
  }

  it.each([
    [
      "1.2.3",
      '"1.2.3" names a single version, not a range; use a range like ^1.2.3',
    ],
    ["v1", '"v1" names a single version, not a range; use a range like ^1.0.0'],
    [
      "=0.3.0",
      '"=0.3.0" names a single version, not a range; use a range like ^0.3.0',
    ],
    [
      "newest please",
      '"newest please" is not a valid semver range; use a range like ^1.2.3 or >=1.2.0 <2.0.0',
    ],
    ["   ", "the range is empty; use a range like ^1.2.3"],
    [
      "<0.1.0",
      "<0.1.0 would only offer releases older than the installed 0.1.0; bb does not downgrade. Use a range that includes 0.1.0 or only newer releases",
    ],
    [
      ">=1.6.0 <1.6.0",
      ">=1.6.0 <1.6.0 admits no version; use a range like ^0.1.0",
    ],
  ])("refuses %j for a git range row", (range, error) => {
    expect(planTrackingRangeChange(stored({}), range)).toEqual({
      ok: false,
      error,
    });
  });

  it.each([
    ["<1.0.0 || >=2.0.0", "1.5.0"],
    ["^1.0.0 || ^2.0.0", "2.0.0-beta.3"],
    [">=0.0.1 <0.1.0 || >=0.3.0", "0.1.0"],
    ["<=1.5.0", "1.5.0"],
  ])(
    "accepts %j at %s, since it admits the installed release or a newer one",
    (range, version) => {
      expect(
        planTrackingRangeChange(storedAt(version, `^${version}`), range),
      ).toMatchObject({ ok: true, plan: { range, unchanged: false } });
    },
  );

  it("collapses whitespace inside a range before comparing and storing it", () => {
    const row = storedAt("0.1.0", ">=0.1.0 <1.0.0");
    expect(planTrackingRangeChange(row, " >=0.1.0 \t <1.0.0\n")).toMatchObject({
      ok: true,
      plan: {
        previousRange: ">=0.1.0 <1.0.0",
        range: ">=0.1.0 <1.0.0",
        unchanged: true,
      },
    });
    expect(planTrackingRangeChange(row, ">=0.1.0   <2.0.0")).toMatchObject({
      ok: true,
      plan: {
        range: ">=0.1.0 <2.0.0",
        unchanged: false,
        change: {
          source: "git:/repo@semver:>=0.1.0 <2.0.0",
          range: ">=0.1.0 <2.0.0",
        },
      },
    });
  });

  it("accepts a wider range, a range of newer releases, and the current range", () => {
    const row = stored({});
    expect(planTrackingRangeChange(row, " >=0.1.0 <1.0.0 ")).toMatchObject({
      ok: true,
      plan: {
        previousRange: "^0.1.0",
        range: ">=0.1.0 <1.0.0",
        unchanged: false,
        change: {
          sourceKind: "git",
          expectedSource: "git:/repo@semver:^0.1.0",
          source: "git:/repo@semver:>=0.1.0 <1.0.0",
          range: ">=0.1.0 <1.0.0",
        },
        proposed: {
          ...row,
          source: "git:/repo@semver:>=0.1.0 <1.0.0",
          sourceGitRange: ">=0.1.0 <1.0.0",
        },
      },
    });
    expect(planTrackingRangeChange(row, "^0.2.0")).toMatchObject({
      ok: true,
      plan: { range: "^0.2.0", unchanged: false },
    });
    expect(planTrackingRangeChange(row, "^0.1.0")).toMatchObject({
      ok: true,
      plan: { previousRange: "^0.1.0", range: "^0.1.0", unchanged: true },
    });
  });

  it.each([
    [">=0.1.0", true],
    [">0.0.9", true],
    ["*", true],
    [">=0.1.0 <1.0.0 || >=2.0.0", true],
    [">=0.1.0 <1.0.0", false],
    [">=0.1.0 <=2.0.0", false],
    ["~0.1.0", false],
    ["0.x", false],
    ["0.1.0 || >=0.2.0 <1.0.0", false],
  ])("reports whether %j lacks an upper bound", (range, openEnded) => {
    expect(planTrackingRangeChange(stored({}), range)).toMatchObject({
      ok: true,
      plan: { range, openEnded },
    });
  });

  it("keeps the tag prefix and compares a prerelease install inside the range", () => {
    const row = stored({
      source: "git:/repo@semver:notes/:^0.2.0-beta.1",
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: "plugins/notes",
        selector: {
          kind: "range",
          range: "^0.2.0-beta.1",
          tagPrefix: "notes/",
          resolvedTag: "notes/v0.2.0-beta.1",
        },
      },
    });
    expect(planTrackingRangeChange(row, ">=0.1.0 <1.0.0")).toMatchObject({
      ok: true,
      plan: {
        change: { source: "git:/repo@semver:notes/:>=0.1.0 <1.0.0" },
        proposed: {
          sourceGitSubdirectory: "plugins/notes",
          sourceGitTagPrefix: "notes/",
          sourceGitResolvedTag: "notes/v0.2.0-beta.1",
        },
      },
    });
  });

  it.each([
    [
      "branch",
      gitRef("main", "branch"),
      'plugin "tracked" follows the git branch "main", not a release range; to track releases, remove it and install `git:/repo@semver:<range>` (removing deletes its settings, secrets, and schedules)',
    ],
    [
      "tag",
      gitRef("v0.1.0", "tag"),
      'plugin "tracked" is pinned to the git tag "v0.1.0", not a release range; to track releases, remove it and install `git:/repo@semver:<range>` (removing deletes its settings, secrets, and schedules)',
    ],
    [
      "commit",
      gitRef("a".repeat(40), "commit"),
      `plugin "tracked" is pinned to the git commit "${"a".repeat(40)}", not a release range; to track releases, remove it and install \`git:/repo@semver:<range>\` (removing deletes its settings, secrets, and schedules)`,
    ],
    [
      "path",
      {
        source: "path:/work/tracked",
        sourceIntent: { kind: "path" as const, canonicalPath: "/work/tracked" },
        exactResolution: { kind: "path" as const },
      },
      'plugin "tracked" is a local path source and has no release range; edit it in place and run `bb plugin reload tracked`',
    ],
    [
      "builtin",
      {
        source: "builtin:tracked",
        provenance: { kind: "builtin" as const },
        sourceIntent: { kind: "builtin" as const, name: "tracked" },
        exactResolution: { kind: "builtin" as const },
      },
      'plugin "tracked" is bundled with bb and updates with bb; it has no release range to change',
    ],
  ])("refuses a %s source", (_kind, input, error) => {
    expect(planTrackingRangeChange(stored(input), "^0.2.0")).toEqual({
      ok: false,
      error,
    });
  });

  it("refuses an unclassified legacy git ref", () => {
    stored(gitRef("release", "branch"));
    db.$client
      .prepare("UPDATE plugins SET source_git_ref_kind = NULL WHERE id = ?")
      .run("tracked");
    const row = getInstalledPluginRegistration(db, "tracked");
    if (row === undefined) throw new Error("fixture row missing");
    expect(planTrackingRangeChange(row, "^0.2.0")).toMatchObject({
      ok: false,
      error: expect.stringContaining('follows the git ref "release"'),
    });
  });

  it("turns any npm spec of a managed artifact into a range", () => {
    expect(
      planTrackingRangeChange(
        npmRow("1.2.3", "exact", "exact-artifact"),
        "^1.2.3",
      ),
    ).toMatchObject({
      ok: true,
      plan: {
        previousRange: "1.2.3",
        range: "^1.2.3",
        unchanged: false,
        change: {
          sourceKind: "npm",
          expectedSource: "npm:bb-plugin-linear@1.2.3",
          source: "npm:bb-plugin-linear@^1.2.3",
        },
        proposed: {
          sourceNpmRequestedSpec: "^1.2.3",
          sourceNpmSpecKind: "range",
          npmResolvedVersion: "1.2.3",
        },
      },
    });
  });

  it.each([
    ["beta", "tag", "beta"],
    ["", "default", null],
  ] as const)(
    "reports the npm %s spec a managed install followed, null when it named none",
    (spec, kind, previousRange) => {
      expect(
        planTrackingRangeChange(
          npmRow(spec, kind, `${kind}-artifact`),
          "^1.2.3",
        ),
      ).toMatchObject({
        ok: true,
        plan: { previousRange, range: "^1.2.3", unchanged: false },
      });
    },
  );

  it("refuses a legacy npm install whose directory is named after its spec", () => {
    expect(
      planTrackingRangeChange(npmRow("", "default", null), "^1.2.3"),
    ).toEqual({
      ok: false,
      error:
        'plugin "linear" was installed by an earlier bb into a directory named after its npm version spec, so bb cannot change its range in place; the next update bb applies to it moves it to managed storage, after which the range can change. To change it now, remove it and install `npm:bb-plugin-linear@<range>` (removing deletes its settings, secrets, and schedules)',
    });
  });

  it("sends a pinned legacy npm install to a reinstall, since it never updates", () => {
    expect(
      planTrackingRangeChange(npmRow("1.2.3", "exact", null), "^1.2.3"),
    ).toEqual({
      ok: false,
      error:
        'plugin "linear" was installed by an earlier bb into a directory named after its pinned npm version, so bb cannot change its range in place; to track releases, remove it and install `npm:bb-plugin-linear@<range>` (removing deletes its settings, secrets, and schedules)',
    });
  });
});

describe("plugin tracking range service and route", () => {
  let db: DbConnection;
  let workDir: string;
  let dataDir: string;
  let repo: string;
  let service: PluginService;
  let app: Hono;
  let broadcasts: string[][];
  let afterArtifactPromoted: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-tracking-range-"));
    dataDir = join(workDir, "data");
    repo = join(workDir, "tracked");
    await mkdir(repo, { recursive: true });
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    await release(repo, "0.1.0");
    broadcasts = [];
    afterArtifactPromoted = undefined;
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        notifyPluginSignal: () => 0,
        onWatchedTargets: () => () => {},
        notifySystem: (kinds) => {
          broadcasts.push([...kinds]);
        },
      },
      logger,
      dataDir,
      appVersion: "1.0.0",
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
      afterArtifactPromoted: async () => afterArtifactPromoted?.(),
    });
    app = new Hono();
    registerPluginRoutes(
      app,
      { config: { serverPort: 3334 }, db },
      service,
      createPluginInstallJobs({ notifyChanged: () => {} }),
      createPluginUpdateJobs({ notifyChanged: () => {} }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  async function pluginState() {
    const api = service.getApi("tracked");
    if (api === undefined) throw new Error("tracked is not loaded");
    return {
      settings: getPluginSettingsValues(db, "tracked"),
      view: (await service.getSettings("tracked"))?.values,
      secret: await readFile(
        join(dataDir, "plugins", "tracked", "secrets", "apiKey"),
        "utf8",
      ),
      kv: getPluginKvValue(db, "tracked", "cursor"),
      notes: api.storage
        .database()
        .prepare("SELECT body FROM notes")
        .pluck()
        .all(),
      schedules: listPluginSchedules(db, "tracked").map(({ name, cron }) => ({
        name,
        cron,
      })),
    };
  }

  function postRange(id: string, body: unknown): Promise<Response> {
    return Promise.resolve(
      app.request(`/plugins/${id}/tracking-range`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("follows a wider range in place and keeps every piece of plugin state through the update it offers", async () => {
    await service.installCatalogPlugin({
      marketplace: "acme-plugins",
      entryId: "tracked-entry",
      pluginId: "tracked",
      source: `git:${repo}@semver:^0.1.0`,
      selection: { kind: "root" },
    });
    await service.updateSettings("tracked", {
      apiKey: "sk-tracked",
      team: "core",
    });
    const api = service.getApi("tracked");
    if (api === undefined) throw new Error("tracked did not load");
    await api.storage.kv.set("cursor", "c-41");
    const pluginDb = api.storage.database();
    pluginDb.exec("CREATE TABLE notes (body TEXT NOT NULL)");
    pluginDb.prepare("INSERT INTO notes VALUES (?)").run("kept");
    const minor = await release(repo, "0.2.0");
    expect(await service.checkForUpdates("tracked")).toMatchObject([
      { id: "tracked", outcome: "current" },
    ]);
    const state = await pluginState();
    const schedules = listPluginSchedules(db, "tracked");
    const before = getInstalledPluginRegistration(db, "tracked");
    broadcasts.length = 0;

    const response = await postRange("tracked", { range: ">=0.1.0 <1.0.0" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applied: true,
      previousRange: "^0.1.0",
      range: ">=0.1.0 <1.0.0",
      openEnded: false,
      check: expect.objectContaining({
        id: "tracked",
        outcome: "update-available",
        candidate: {
          version: minor,
          label: "0.2.0",
          display: expect.stringContaining("@v0.2.0"),
        },
      }),
    });
    expect(getInstalledPluginRegistration(db, "tracked")).toEqual({
      ...before,
      source: `git:${repo}@semver:>=0.1.0 <1.0.0`,
      sourceGitRange: ">=0.1.0 <1.0.0",
      lastUpdateCheckAt: expect.any(Number),
      availableCompatibleVersion: minor,
      updateStatusDetail: expect.stringContaining('"update-available"'),
      updatedAt: expect.any(Number),
    });
    expect(await pluginState()).toEqual(state);
    expect(listPluginSchedules(db, "tracked")).toEqual(schedules);
    expect(broadcasts).toContainEqual(["plugins-changed"]);
    expect(
      service.list().find((plugin) => plugin.id === "tracked"),
    ).toMatchObject({
      enabled: true,
      status: "running",
      provenance: "catalog",
      catalogEntryId: "tracked-entry",
      catalogMarketplaceName: "acme-plugins",
      updateState: { outcome: "update-available", availableVersion: minor },
    });
    await expect(service.getSource("tracked")).resolves.toMatchObject({
      requested: `git:${repo}@semver:>=0.1.0 <1.0.0`,
      range: ">=0.1.0 <1.0.0",
      resolvedTag: "v0.1.0",
    });

    await expect(service.applyUpdate("tracked")).resolves.toMatchObject({
      ok: true,
      result: { applied: true, outcome: "updated", to: { version: minor } },
    });
    expect(getInstalledPluginRegistration(db, "tracked")).toMatchObject({
      source: `git:${repo}@semver:>=0.1.0 <1.0.0`,
      sourceGitRange: ">=0.1.0 <1.0.0",
      sourceGitResolvedTag: "v0.2.0",
      gitResolvedCommit: minor,
      version: "0.2.0",
      enabled: true,
      provenance: "catalog",
      catalogEntryId: "tracked-entry",
      catalogMarketplaceName: "acme-plugins",
    });
    expect(await pluginState()).toEqual(state);
  }, 120_000);

  it("accepts a range of newer releases for a disabled plugin and keeps it disabled", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    await service.setEnabled("tracked", false);
    const minor = await release(repo, "0.2.0");

    await expect(
      service.setTrackingRange("tracked", { range: "^0.2.0" }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: true,
        previousRange: "^0.1.0",
        range: "^0.2.0",
        check: { outcome: "update-available", candidate: { version: minor } },
      },
    });
    expect(getInstalledPluginRegistration(db, "tracked")).toMatchObject({
      sourceGitRange: "^0.2.0",
      sourceGitResolvedTag: "v0.1.0",
      enabled: false,
    });
    expect(
      service.list().find((plugin) => plugin.id === "tracked"),
    ).toMatchObject({ enabled: false, status: "disabled" });
  }, 60_000);

  it("previews a range without persisting anything, and treats the current range as a no-op", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    const minor = await release(repo, "0.2.0");
    await service.checkForUpdates("tracked");
    const before = getInstalledPluginRegistration(db, "tracked");
    const results = service.listUpdateResults();
    const artifacts = listPluginArtifacts(db, "tracked");
    broadcasts.length = 0;

    await expect(
      service.setTrackingRange("tracked", {
        range: ">=0.1.0 <1.0.0",
        dryRun: true,
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        applied: false,
        previousRange: "^0.1.0",
        range: ">=0.1.0 <1.0.0",
        openEnded: false,
        check: expect.objectContaining({
          outcome: "update-available",
          candidate: expect.objectContaining({ version: minor }),
        }),
      },
    });
    await expect(
      service.setTrackingRange("tracked", { range: "^0.1.0" }),
    ).resolves.toEqual({
      ok: true,
      result: {
        applied: false,
        previousRange: "^0.1.0",
        range: "^0.1.0",
        openEnded: false,
        check: expect.objectContaining({ outcome: "current" }),
      },
    });
    const openEnded = await postRange("tracked", {
      range: ">=0.1.0",
      dryRun: true,
    });
    expect(openEnded.status).toBe(200);
    expect(await openEnded.json()).toEqual({
      applied: false,
      previousRange: "^0.1.0",
      range: ">=0.1.0",
      openEnded: true,
      check: expect.objectContaining({
        outcome: "update-available",
        candidate: expect.objectContaining({ version: minor }),
      }),
    });

    expect(getInstalledPluginRegistration(db, "tracked")).toEqual(before);
    expect(service.listUpdateResults()).toEqual(results);
    expect(listPluginArtifacts(db, "tracked")).toEqual(artifacts);
    expect(broadcasts).toEqual([]);
  }, 60_000);

  it("previews what a new range offers and the newer release it still excludes", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    const minor = await release(repo, "0.2.0");
    await release(repo, "1.0.0");

    await expect(
      service.setTrackingRange("tracked", {
        range: ">=0.1.0 <1.0.0",
        dryRun: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: false,
        openEnded: false,
        check: {
          outcome: "update-available",
          candidate: { version: minor },
          candidateBreaking: true,
          outsideRange: {
            version: "1.0.0",
            breaking: true,
            range: ">=0.1.0 <1.0.0",
            suggestedRange: ">=0.1.0 <2.0.0",
          },
        },
      },
    });
  }, 60_000);

  it("refuses unsupported sources and ranges over HTTP and leaves the row unchanged", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    const before = getInstalledPluginRegistration(db, "tracked");

    for (const [body, status, error] of [
      [{}, 400, 'expected { "range": string, "dryRun"?: boolean }'],
      [
        { range: "^0.2.0", force: true },
        400,
        'expected { "range": string, "dryRun"?: boolean }',
      ],
      [
        { range: "0.2.0" },
        422,
        '"0.2.0" names a single version, not a range; use a range like ^0.2.0',
      ],
      [
        { range: "latest" },
        422,
        '"latest" is not a valid semver range; use a range like ^1.2.3 or >=1.2.0 <2.0.0',
      ],
      [
        { range: "<0.1.0", dryRun: true },
        422,
        "<0.1.0 would only offer releases older than the installed 0.1.0; bb does not downgrade. Use a range that includes 0.1.0 or only newer releases",
      ],
    ] as const) {
      const response = await postRange("tracked", body);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
    const unknown = await postRange("missing", { range: "^1.0.0" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown plugin "missing"' });
    expect(getInstalledPluginRegistration(db, "tracked")).toEqual(before);

    await service.remove("tracked");
    await service.install(`git:${repo}@main`, { kind: "root" });
    const branch = await postRange("tracked", { range: "^0.2.0" });
    expect(branch.status).toBe(422);
    expect(await branch.json()).toEqual({
      error: `plugin "tracked" follows the git branch "main", not a release range; to track releases, remove it and install \`git:${repo}@semver:<range>\` (removing deletes its settings, secrets, and schedules)`,
    });
  }, 60_000);

  it("plans a range change against the release an in-flight update activates", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    const patch = await release(repo, "0.1.1");
    const minor = await release(repo, "0.2.0");
    let reportPromotion!: () => void;
    const promotionReached = new Promise<void>((resolve) => {
      reportPromotion = resolve;
    });
    let releasePromotion!: () => void;
    const holdPromotion = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    afterArtifactPromoted = async () => {
      reportPromotion();
      await holdPromotion;
    };

    const update = service.applyUpdate("tracked");
    await promotionReached;
    let settled = false;
    const tracking = service
      .setTrackingRange("tracked", { range: ">=0.1.0 <0.1.1" })
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBe(false);
    afterArtifactPromoted = undefined;
    releasePromotion();

    await expect(update).resolves.toMatchObject({
      ok: true,
      result: { applied: true, to: { version: patch } },
    });
    await expect(tracking).resolves.toEqual({
      ok: false,
      reason: "refused",
      error:
        ">=0.1.0 <0.1.1 would only offer releases older than the installed 0.1.1; bb does not downgrade. Use a range that includes 0.1.1 or only newer releases",
    });
    expect(getInstalledPluginRegistration(db, "tracked")).toMatchObject({
      sourceGitRange: "^0.1.0",
      sourceGitResolvedTag: "v0.1.1",
      version: "0.1.1",
    });

    await expect(
      service.setTrackingRange("tracked", { range: ">=0.1.0 <1.0.0" }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: true,
        previousRange: "^0.1.0",
        check: {
          outcome: "update-available",
          installed: { version: patch },
          candidate: { version: minor },
        },
      },
    });
    expect(getInstalledPluginRegistration(db, "tracked")).toMatchObject({
      source: `git:${repo}@semver:>=0.1.0 <1.0.0`,
      sourceGitRange: ">=0.1.0 <1.0.0",
      sourceGitResolvedTag: "v0.1.1",
      gitResolvedCommit: patch,
    });
  }, 120_000);

  it("previews a range while an in-flight update holds the registration lock", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    const patch = await release(repo, "0.1.1");
    const minor = await release(repo, "0.2.0");
    let reportPromotion!: () => void;
    const promotionReached = new Promise<void>((resolve) => {
      reportPromotion = resolve;
    });
    let releasePromotion!: () => void;
    const holdPromotion = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    afterArtifactPromoted = async () => {
      reportPromotion();
      await holdPromotion;
    };

    let updateSettled = false;
    const update = service.applyUpdate("tracked").finally(() => {
      updateSettled = true;
    });
    await promotionReached;

    await expect(
      service.setTrackingRange("tracked", {
        range: ">=0.1.0 <1.0.0",
        dryRun: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: false,
        range: ">=0.1.0 <1.0.0",
        check: { outcome: "update-available", candidate: { version: minor } },
      },
    });
    expect(updateSettled).toBe(false);

    afterArtifactPromoted = undefined;
    releasePromotion();
    await expect(update).resolves.toMatchObject({
      ok: true,
      result: { applied: true, to: { version: patch } },
    });
    expect(getInstalledPluginRegistration(db, "tracked")).toMatchObject({
      sourceGitRange: "^0.1.0",
      sourceGitResolvedTag: "v0.1.1",
    });
  }, 120_000);

  it("records an unreachable source after the change as unavailable, and a preview persists nothing", async () => {
    await service.install(`git:${repo}@semver:^0.1.0`, { kind: "root" });
    await rename(repo, `${repo}-moved`);

    await expect(
      service.setTrackingRange("tracked", { range: "^0.2.0", dryRun: true }),
    ).resolves.toMatchObject({
      ok: true,
      result: { applied: false, check: { outcome: "unavailable" } },
    });
    expect(service.listUpdateResults()).toEqual([
      expect.objectContaining({
        id: "tracked",
        detail: "updates have not been checked yet",
      }),
    ]);

    await expect(
      service.setTrackingRange("tracked", { range: "^0.2.0" }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: true,
        check: { outcome: "unavailable", detail: expect.any(String) },
      },
    });
    expect(service.listUpdateResults()).toEqual([
      expect.objectContaining({
        id: "tracked",
        outcome: "unavailable",
        detail: expect.not.stringContaining("not been checked"),
      }),
    ]);
    expect(getInstalledPluginRegistration(db, "tracked")?.sourceGitRange).toBe(
      "^0.2.0",
    );
  }, 60_000);

  it("changes an npm row with an active artifact, after pinned updates point at track", async () => {
    createPluginArtifact(db, {
      id: "linear-artifact",
      pluginId: "linear",
      sourceKind: "npm",
      npmResolvedVersion: "1.0.0",
      gitResolvedCommit: null,
      gitCheckoutRoot: null,
      path: join(workDir, "linear"),
      integrity: "sha512-current",
      contentHash: null,
      validationResult: "valid",
      validatedAt: 1,
    });
    upsertInstalledPlugin(db, {
      id: "linear",
      source: "npm:bb-plugin-linear@1.0.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.test",
        requestedSpec: "1.0.0",
        specKind: "exact",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-current",
      },
      updateState: EMPTY_UPDATE_STATE,
      activeArtifactId: "linear-artifact",
      rootDir: join(workDir, "linear"),
      version: "1.0.0",
      enabled: false,
      enabledFollowsDefault: false,
    });
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      requested.push(String(input));
      return Response.json({
        versions: Object.fromEntries(
          ["1.0.0", "1.1.0", "2.0.0"].map((version) => [
            version,
            { version, dist: { integrity: `sha512-${version}` } },
          ]),
        ),
        "dist-tags": { latest: "2.0.0" },
      });
    });

    await expect(service.applyUpdate("linear")).resolves.toEqual({
      ok: false,
      error:
        'plugin "linear" is pinned to bb-plugin-linear@1.0.0; run `bb plugin track linear <range>` to follow a semver range such as ^1.0.0 (settings, secrets, and schedules are kept)',
    });
    await expect(
      service.setTrackingRange("linear", { range: "^1.0.0" }),
    ).resolves.toEqual({
      ok: true,
      result: {
        applied: true,
        previousRange: "1.0.0",
        range: "^1.0.0",
        openEnded: false,
        check: expect.objectContaining({
          outcome: "update-available",
          candidate: expect.objectContaining({
            version: "1.1.0",
            display: "bb-plugin-linear@1.1.0",
          }),
        }),
      },
    });
    expect(getInstalledPluginRegistration(db, "linear")).toMatchObject({
      source: "npm:bb-plugin-linear@^1.0.0",
      sourceNpmRequestedSpec: "^1.0.0",
      sourceNpmSpecKind: "range",
      npmResolvedVersion: "1.0.0",
      activeArtifactId: "linear-artifact",
      enabled: false,
    });
    await expect(service.getSource("linear")).resolves.toMatchObject({
      requested: "npm:bb-plugin-linear@^1.0.0",
      range: "^1.0.0",
    });
    expect(requested).toContain("https://registry.test/bb-plugin-linear");
  });

  it.each([
    ["beta", "tag", { npmSpecKind: "tag", distTag: "beta" }],
    ["", "default", { npmSpecKind: "default" }],
    ["1.0.0", "exact", { npmSpecKind: "exact" }],
    ["^1.0.0", "range", { npmSpecKind: "range", range: "^1.0.0" }],
  ] as const)(
    "reports what an npm %j spec follows in the plugin's source",
    async (spec, kind, expected) => {
      upsertInstalledPlugin(db, {
        id: "linear",
        source:
          kind === "default"
            ? "npm:bb-plugin-linear"
            : `npm:bb-plugin-linear@${spec}`,
        provenance: { kind: "direct" },
        sourceIntent: {
          kind: "npm",
          packageName: "bb-plugin-linear",
          registry: "https://registry.test",
          requestedSpec: spec,
          specKind: kind,
        },
        exactResolution: {
          kind: "npm",
          version: "1.0.0",
          integrity: "sha512-current",
        },
        updateState: EMPTY_UPDATE_STATE,
        activeArtifactId: null,
        rootDir: join(workDir, "linear"),
        version: "1.0.0",
        enabled: false,
        enabledFollowsDefault: false,
      });

      const { range, npmSpecKind, distTag } =
        (await service.getSource("linear")) ?? {};

      expect({ range, npmSpecKind, distTag }).toEqual(expected);
    },
  );

  it("gives a pinned legacy npm install the reinstall guidance track refuses it with", async () => {
    upsertInstalledPlugin(db, {
      id: "linear",
      source: "npm:bb-plugin-linear@1.0.0",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.test",
        requestedSpec: "1.0.0",
        specKind: "exact",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-current",
      },
      updateState: EMPTY_UPDATE_STATE,
      activeArtifactId: null,
      rootDir: join(workDir, "linear"),
      version: "1.0.0",
      enabled: false,
      enabledFollowsDefault: false,
    });
    const refusal =
      'plugin "linear" was installed by an earlier bb into a directory named after its pinned npm version, so bb cannot change its range in place; to track releases, remove it and install `npm:bb-plugin-linear@<range>` (removing deletes its settings, secrets, and schedules)';

    await expect(service.checkForUpdates("linear")).resolves.toEqual([
      {
        id: "linear",
        outcome: "pinned",
        installed: {
          version: "1.0.0",
          label: "1.0.0",
          display: "bb-plugin-linear@1.0.0",
        },
        detail: refusal,
      },
    ]);
    await expect(
      service.setTrackingRange("linear", { range: "^1.0.0" }),
    ).resolves.toEqual({ ok: false, reason: "refused", error: refusal });
  });

  it.each([
    ["managed", "linear-artifact", { suggestedRange: ">=1.0.0 <3.0.0" }],
    ["legacy", null, {}],
  ] as const)(
    "suggests a range for the release outside a %s npm install's range only if track can change it",
    async (_kind, artifactId, suggestion) => {
      if (artifactId !== null) {
        createPluginArtifact(db, {
          id: artifactId,
          pluginId: "linear",
          sourceKind: "npm",
          npmResolvedVersion: "1.0.0",
          gitResolvedCommit: null,
          gitCheckoutRoot: null,
          path: join(workDir, "linear"),
          integrity: "sha512-current",
          contentHash: null,
          validationResult: "valid",
          validatedAt: 1,
        });
      }
      upsertInstalledPlugin(db, {
        id: "linear",
        source: "npm:bb-plugin-linear@^1.0.0",
        provenance: { kind: "direct" },
        sourceIntent: {
          kind: "npm",
          packageName: "bb-plugin-linear",
          registry: "https://registry.test",
          requestedSpec: "^1.0.0",
          specKind: "range",
        },
        exactResolution: {
          kind: "npm",
          version: "1.0.0",
          integrity: "sha512-current",
        },
        updateState: EMPTY_UPDATE_STATE,
        activeArtifactId: artifactId,
        rootDir: join(workDir, "linear"),
        version: "1.0.0",
        enabled: false,
        enabledFollowsDefault: false,
      });
      vi.stubGlobal("fetch", async () =>
        Response.json({
          versions: Object.fromEntries(
            ["1.0.0", "1.1.0", "2.0.0"].map((version) => [
              version,
              { version, dist: { integrity: `sha512-${version}` } },
            ]),
          ),
          "dist-tags": { latest: "2.0.0" },
        }),
      );

      const [check] = await service.checkForUpdates("linear");

      expect(check?.outsideRange).toEqual({
        version: "2.0.0",
        display: "bb-plugin-linear@2.0.0",
        breaking: true,
        range: "^1.0.0",
        ...suggestion,
      });
    },
  );
});
