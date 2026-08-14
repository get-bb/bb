import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { findingStableKey, parseKey } from "../../../lib/sync/registry.js";
import {
  RemoteError,
  type Json,
  type PlatformClient as PlatformClientContract,
} from "../../../lib/remote/types.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../../test/mock-remote/server.js";
import { registerPlatformHandlers } from "../../../test/mock-remote/platform/register.js";
import { createMockPlatformState } from "../../../test/mock-remote/platform/state.js";
import { createBomCommandServices } from "../register.js";
import { normalizeComponent, pullSbom } from "./pull.js";
import { querySbom } from "./query.js";
import { componentKeyFromIdentity } from "./rollup.js";

const FIXTURE_ROOT = resolve(
  import.meta.dirname,
  "../../../test/mock-remote/fixtures",
);
const TOKEN = "sbom-pull-test-token";
const roots: string[] = [];
const harnesses: MockRemoteHarness[] = [];
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "fs-sbom-pull-"));
  roots.push(value);
  return value;
}

function setupPlatform(): {
  client: PlatformClient;
  harness: MockRemoteHarness;
  state: ReturnType<typeof createMockPlatformState>;
  projectId: string;
  projectVersionId: string;
} {
  const state = createMockPlatformState(FIXTURE_ROOT);
  const harness = createMockRemote({
    platformToken: TOKEN,
    assuranceStudioKey: "unused",
    fixtureRoot: FIXTURE_ROOT,
    register(service, registry) {
      if (service === "platform") registerPlatformHandlers(registry, state);
    },
  });
  harnesses.push(harness);
  const projectId = String([...state.projects.values()][0]?.id);
  const projectVersionId = String(
    [...state.versions.values()].find(
      (version) => version.priorVersionId !== null,
    )?.id,
  );
  return {
    harness,
    state,
    projectId,
    projectVersionId,
    client: new PlatformClient({
      baseUrl: "http://platform.mock",
      token: TOKEN,
      fetch: harness.platform.fetch,
    }),
  };
}

function seedAccepted(db: Database.Database): string {
  const key = componentKeyFromIdentity({
    purl: "pkg:generic/old@1",
    name: "old",
    group: null,
    version: "1",
  });
  db.exec(`
    INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status,
       requested_kinds_json, started_at, completed_at, accepted_at)
    VALUES ('p', 'v', 'old-g', 'accepted', '["sbomComponent"]',
            '2026-08-12T19:00:00.000Z', '2026-08-12T19:00:00.000Z',
            '2026-08-12T19:00:00.000Z');
    INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id,
       base_revision, last_pull)
    VALUES ('p', 'v', 'sbomComponent', 'old-g', 1, '2026-08-12T19:00:00.000Z');
  `);
  db.prepare(
    `INSERT INTO sbom_components
      (project_id, project_version_id, generation_id, component_id,
       component_key, purl, name, version, raw, pulled_at)
     VALUES ('p', 'v', 'old-g', 'old-id', ?, 'pkg:generic/old@1',
             'old', '1', '{}', '2026-08-12T19:00:00.000Z')`,
  ).run(key);
  return key;
}

function seedStaging(
  db: Database.Database,
  generationId: string,
  projectId = "p",
  projectVersionId = "v",
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at)
     VALUES (?, ?, ?, 'staging', '["sbomComponent"]',
             '2026-08-12T20:00:00.000Z')`,
  ).run(projectId, projectVersionId, generationId);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, staging_generation_id,
        staging_continuation, staged_pages, staged_rows)
     VALUES (?, ?, 'sbomComponent', ?, NULL, 0, 0)
     ON CONFLICT(project_id, project_version_id, entity_kind) DO UPDATE SET
       staging_generation_id = excluded.staging_generation_id,
       staging_continuation = NULL,
       staged_pages = 0,
       staged_rows = 0,
       error = NULL`,
  ).run(projectId, projectVersionId, generationId);
}

const rowA = {
  id: "a",
  name: "Alpha",
  purl: "pkg:generic/alpha@1",
  version: "1",
};
const rowB = { id: "b", name: "Beta", purl: null, group: "Core", version: "2" };

function scopedPlatform(
  components: Pick<PlatformClientContract, "listComponents">,
  projectId = "p",
  projectVersionId = "v",
): Pick<PlatformClientContract, "listComponents" | "listVersions"> {
  return {
    ...components,
    async *listVersions(candidateProjectId: string) {
      const items =
        candidateProjectId === projectId ? [{ id: projectVersionId }] : [];
      yield { items, total: items.length, next: null };
    },
  };
}

describe("resumable SBOM pull", () => {
  it("derives captured path keys and pins the legacy compatibility boundary", () => {
    const normalized = normalizeComponent({
      id: "firmware-path-row",
      name: "bin/busybox",
      group: "vendor/acme",
      purl: "pkg:generic/busybox@1.36",
      version: "1.36",
    });
    expect(normalized.componentKey).toBe(
      componentKeyFromIdentity({
        purl: "pkg:generic/busybox@1.36",
        name: "any-safe-name",
        group: null,
        version: null,
      }),
    );
    const pathOnly = normalizeComponent({
      id: "fs195-path-only",
      name: "/update/firmware-root/etc/ssl/certs/ca-certificates.crt",
      purl: null,
      version: "1.0",
    });
    expect(parseKey(pathOnly.componentKey)).toEqual([
      "finding",
      "name-group-version",
      "SBOM-COMPONENT",
      "ca-certificates.crt",
      "update%2ffirmware-root%2fetc%2fssl%2fcerts",
      "1.0",
    ]);
    expect(
      parseKey(
        componentKeyFromIdentity({
          purl: null,
          name: "Beta",
          group: "Core",
          version: "2",
        }),
      ),
    ).toEqual([
      "finding",
      "name-group-version",
      "SBOM-COMPONENT",
      "beta",
      "core",
      "2",
    ]);
    expect(
      componentKeyFromIdentity({
        purl: "pkg:generic/busybox@1.36",
        name: "ignored-path/name",
        group: "ignored group",
        version: "ignored",
      }),
    ).toBe(
      findingStableKey({
        cve: "SBOM-COMPONENT",
        purl: "pkg:generic/busybox@1.36",
        name: "purl-identified-component",
        group: null,
        version: null,
      }),
    );
    const legacyEscapedGroup = findingStableKey({
      cve: "SBOM-COMPONENT",
      purl: null,
      name: "kernel",
      group: "日本",
      version: "1",
    });
    const canonicalEscapedGroup = componentKeyFromIdentity({
      purl: null,
      name: "kernel",
      group: "日本",
      version: "1",
    });
    expect(parseKey(legacyEscapedGroup)[4]).toBe("日本");
    expect(parseKey(canonicalEscapedGroup)[4]).toBe("%e6%97%a5%e6%9c%ac");
    expect(canonicalEscapedGroup).not.toBe(legacyEscapedGroup);
  });

  it("fully drains the audited 900-component Platform iterable and publishes one atomic slice", async () => {
    const db = createDb();
    const worktreeRoot = await root();
    const { client, state, projectId, projectVersionId } = setupPlatform();
    state.components.set("96bc2266-foreign", {
      id: "96bc2266-foreign",
      name: "/apps/foreign-tenant.elf",
      version: "1",
      purl: "pkg:generic/%2Fapps%2Fforeign-tenant.elf@1",
      project: { id: "foreign-project" },
      projectVersion: { id: "foreign-version" },
      excluded: false,
      edited: false,
    });
    const progress = vi.fn();
    seedStaging(db, "generation-a", projectId, projectVersionId);
    const result = await pullSbom(
      {
        db,
        platform: client,
        stagingRoot: worktreeRoot,
        generationId: "generation-a",
        pageSize: 37,
        now: () => new Date("2026-08-12T20:00:00.000Z"),
        publishProgress: progress,
      },
      { projectId, projectVersionId },
    );

    expect(result).toEqual({
      projectVersionId,
      fetched: 900,
      components: 900,
      quarantined: 0,
      quarantineReasons: {},
      pages: Math.ceil(899 / 37) + 1,
      rollups: 900,
      pulledAt: "2026-08-12T20:00:00.000Z",
      resumed: false,
    });
    expect(
      db.prepare("SELECT COUNT(*) FROM sbom_components").pluck().get(),
    ).toBe(900);
    expect(
      db
        .prepare("SELECT COUNT(DISTINCT component_id) FROM sbom_components")
        .pluck()
        .get(),
    ).toBe(900);
    expect(
      db.prepare("SELECT COUNT(*) FROM sbom_vuln_rollup").pluck().get(),
    ).toBe(900);
    const noPurl = db
      .prepare<
        [],
        { component_id: string; component_key: string; purl: null }
      >("SELECT component_id, component_key, purl FROM sbom_components WHERE purl IS NULL LIMIT 1")
      .get()!;
    expect(noPurl.purl).toBeNull();
    expect(parseKey(noPurl.component_key).slice(0, 2)).toEqual([
      "finding",
      "name-group-version",
    ]);
    expect(noPurl.component_key).not.toContain(noPurl.component_id);
    expect(progress).toHaveBeenCalledTimes(Math.ceil(899 / 37) + 1);
    expect(Object.keys(progress.mock.calls[0]![0]).sort()).toEqual([
      "components",
      "pages",
      "projectVersionId",
    ]);
    client.close();
    db.close();
  });

  it("quarantines genuinely unkeyable rows with truthful per-reason counts", async () => {
    const db = createDb();
    const oldKey = seedAccepted(db);
    seedStaging(db, "generation-next");
    const worktreeRoot = await root();
    const inputs: Array<
      Parameters<PlatformClientContract["listComponents"]>[0]
    > = [];
    const malformed = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        inputs.push(input);
        if (input.excluded) {
          yield { items: [], total: 0, next: null };
          return;
        }
        const items: Record<string, Json>[] = [
          rowA,
          { id: "malformed-without-name" },
          { name: "component-without-id" },
        ];
        yield {
          items,
          total: 3,
          next: null,
        };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    const warn = vi.fn();
    const result = await pullSbom(
      {
        db,
        platform: scopedPlatform(malformed),
        stagingRoot: worktreeRoot,
        generationId: "generation-next",
        now: () => new Date("2026-08-12T20:00:00.000Z"),
        warn,
      },
      { projectId: "p", projectVersionId: "v" },
    );
    expect(inputs).toEqual([
      {
        filter: "project==p;projectVersion==v",
        excluded: false,
        page: { pageSize: 200 },
      },
      {
        filter: "project==p;projectVersion==v",
        excluded: true,
        page: { pageSize: 200 },
      },
    ]);
    expect(result).toMatchObject({
      fetched: 3,
      components: 1,
      quarantined: 2,
      quarantineReasons: {
        SBOM_COMPONENT_ID_MISSING: 1,
        SBOM_COMPONENT_NAME_MISSING: 1,
      },
    });
    expect(warn).toHaveBeenCalledWith(
      "SBOM component rows quarantined (SBOM_COMPONENT_NAME_MISSING)",
      { count: 1, projectVersionId: "v" },
    );
    expect(warn).toHaveBeenCalledWith(
      "SBOM component rows quarantined (SBOM_COMPONENT_ID_MISSING)",
      { count: 1, projectVersionId: "v" },
    );
    expect(
      querySbom(db, { projectVersionId: "v" }).items[0]!.componentKey,
    ).toBe(oldKey);
    expect(
      db
        .prepare(
          "SELECT component_id FROM sbom_components WHERE generation_id = 'generation-next' ORDER BY component_id",
        )
        .pluck()
        .all(),
    ).toEqual(["a"]);
    db.close();
  });

  it("refuses an all-quarantined replacement and preserves the accepted slice", async () => {
    const db = createDb();
    const oldKey = seedAccepted(db);
    seedStaging(db, "all-quarantined-generation");
    const worktreeRoot = await root();
    let repaired = false;
    const platform = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        yield input.excluded
          ? { items: [], total: 0, next: null }
          : {
              items: repaired ? [rowA] : [{ id: "unkeyable" }],
              total: 1,
              next: null,
            };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;

    await expect(
      pullSbom(
        {
          db,
          platform: scopedPlatform(platform),
          stagingRoot: worktreeRoot,
          generationId: "all-quarantined-generation",
        },
        { projectId: "p", projectVersionId: "v" },
      ),
    ).rejects.toMatchObject({
      code: "SBOM_ALL_ROWS_QUARANTINED",
      message: expect.stringContaining("SBOM_COMPONENT_NAME_MISSING=1"),
    });
    expect(
      querySbom(db, { projectVersionId: "v" }).items[0]!.componentKey,
    ).toBe(oldKey);
    expect(
      db
        .prepare(
          "SELECT staged_quarantined FROM sync_state WHERE entity_kind = 'sbomComponent'",
        )
        .pluck()
        .get(),
    ).toBe(1);
    repaired = true;
    await expect(
      pullSbom(
        {
          db,
          platform: scopedPlatform(platform),
          stagingRoot: worktreeRoot,
          generationId: "all-quarantined-generation",
        },
        { projectId: "p", projectVersionId: "v", resume: true },
      ),
    ).resolves.toMatchObject({
      components: 1,
      quarantined: 0,
      quarantineReasons: {},
    });
    db.close();
  });

  it("rejects RSQL scope injection before contacting Platform", async () => {
    const db = createDb();
    seedStaging(db, "invalid-scope", "p;name==foreign", "v");
    const worktreeRoot = await root();
    const listComponents = vi.fn(async function* () {
      yield { items: [], total: 0, next: null };
    });
    await expect(
      pullSbom(
        {
          db,
          platform: scopedPlatform({ listComponents }),
          stagingRoot: worktreeRoot,
          generationId: "invalid-scope",
        },
        { projectId: "p;name==foreign", projectVersionId: "v" },
      ),
    ).rejects.toMatchObject({ code: "SBOM_SCOPE_INVALID" });
    expect(listComponents).not.toHaveBeenCalled();
    db.close();
  });

  it("refuses a nonexistent project version before listing components", async () => {
    const db = createDb();
    seedStaging(db, "missing-version-generation", "p", "missing-version");
    const worktreeRoot = await root();
    const listComponents = vi.fn(async function* () {
      yield { items: [], total: 0, next: null };
    });

    await expect(
      pullSbom(
        {
          db,
          platform: scopedPlatform({ listComponents }, "p", "real-version"),
          stagingRoot: worktreeRoot,
          generationId: "missing-version-generation",
        },
        { projectId: "p", projectVersionId: "missing-version" },
      ),
    ).rejects.toMatchObject({
      code: "REMOTE_HTTP_404",
      status: 404,
      message: "Platform project version was not found",
    });
    expect(listComponents).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          "SELECT accepted_generation_id FROM sync_state WHERE entity_kind = 'sbomComponent'",
        )
        .pluck()
        .get(),
    ).toBeNull();
    db.close();
  });

  it("preserves the complete cache after a mid-stream 429 and resumes its staged page", async () => {
    const db = createDb();
    const oldKey = seedAccepted(db);
    seedStaging(db, "rate-limited-generation");
    const worktreeRoot = await root();
    const rateLimited = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        if (!input.excluded) {
          yield {
            items: [rowA, { id: "quarantined-before-retry" }],
            total: 3,
            next: "after-one",
          };
        }
        throw new RemoteError("Rate limited", {
          service: "platform",
          code: "REMOTE_RATE_LIMITED",
          status: 429,
          retryable: true,
          retryAfterMs: 2_000,
          details: null,
        });
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    await expect(
      pullSbom(
        {
          db,
          platform: scopedPlatform(rateLimited),
          stagingRoot: worktreeRoot,
          generationId: "rate-limited-generation",
        },
        { projectId: "p", projectVersionId: "v" },
      ),
    ).rejects.toMatchObject({ code: "REMOTE_RATE_LIMITED", status: 429 });
    const page = querySbom(db, { projectVersionId: "v" });
    expect(page.items[0]!.componentKey).toBe(oldKey);
    expect(page.cache).toMatchObject({
      state: "stale",
      asOf: "2026-08-12T19:00:00.000Z",
      message: expect.stringMatching(/Platform.*REMOTE_RATE_LIMITED.*Retry/u),
    });
    expect(
      db.prepare("SELECT is_stale FROM sbom_components").pluck().get(),
    ).toBe(1);

    const staged = db
      .prepare<
        [],
        {
          staged_pages: number;
          staged_rows: number;
          staged_quarantined: number;
        }
      >(
        "SELECT staged_pages, staged_rows, staged_quarantined FROM sync_state WHERE entity_kind = 'sbomComponent'",
      )
      .get()!;
    expect(staged).toEqual({
      staged_pages: 1,
      staged_rows: 1,
      staged_quarantined: 1,
    });
    // Simulate the bounded crash window between the page commit and shared
    // cursor update; resume should heal from the request-owned staging DB.
    db.prepare(
      `UPDATE sync_state
          SET staging_continuation = NULL, staged_pages = 0, staged_rows = 0,
              staged_quarantined = 0
        WHERE entity_kind = 'sbomComponent'`,
    ).run();
    const resumedInputs: Array<
      Parameters<PlatformClientContract["listComponents"]>[0]
    > = [];
    const recovered = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        resumedInputs.push(input);
        yield input.excluded
          ? { items: [], total: 0, next: null }
          : { items: [rowB], total: 3, next: null };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    const result = await pullSbom(
      {
        db,
        platform: scopedPlatform(recovered),
        stagingRoot: worktreeRoot,
        generationId: "rate-limited-generation",
      },
      { projectId: "p", projectVersionId: "v", resume: true },
    );
    expect(result).toMatchObject({
      fetched: 1,
      components: 2,
      quarantined: 1,
      quarantineReasons: { SBOM_COMPONENT_NAME_MISSING: 1 },
      pages: 3,
      resumed: true,
    });
    expect(resumedInputs[0]).toEqual({
      filter: "project==p;projectVersion==v",
      excluded: false,
      page: { pageSize: 200, continuation: "after-one" },
    });
    expect(
      db
        .prepare(
          "SELECT component_id FROM sbom_components WHERE generation_id = 'rate-limited-generation' ORDER BY component_id",
        )
        .pluck()
        .all(),
    ).toEqual(["a", "b"]);
    db.close();
  });

  it("publishes only count progress through the registered service", async () => {
    const db = createDb();
    const worktreeRoot = await root();
    const host = createFakePluginHost({ pluginId: "finite-state-bom-signals" });
    hosts.push(host);
    const platform = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        yield input.excluded
          ? { items: [], total: 0, next: null }
          : {
              items: [{ ...rowA, cpe: "cpe:/a:alpha:alpha:1", isStale: true }],
              total: 1,
              next: null,
            };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    const service = createBomCommandServices(host.bb, db, () =>
      scopedPlatform(platform),
    );
    seedStaging(db, "service-generation");
    await service.pull({
      projectId: "p",
      projectVersionId: "v",
      stagingRoot: worktreeRoot,
      generationId: "service-generation",
    });
    expect(host.harness.realtimeSignals).toEqual([
      {
        channel: "bom:progress",
        payload: { projectVersionId: "v", components: 1, pages: 1 },
      },
      {
        channel: "bom:progress",
        payload: { projectVersionId: "v", components: 1, pages: 2 },
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT cpe, source, is_stale
         FROM sbom_components
        WHERE generation_id = 'service-generation'`,
        )
        .get(),
    ).toMatchObject({
      cpe: "cpe:/a:alpha:alpha:1",
      source: "platform",
      is_stale: 1,
    });
    db.close();
  });
});
