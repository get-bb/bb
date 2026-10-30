import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPluginArtifact,
  createPluginStateSnapshot,
  deletePluginArtifact,
  deleteInstalledPlugin,
  getInstalledPluginRegistration,
  getInstalledPlugin,
  listPluginArtifacts,
  listPluginArtifactsAtOrUnderPath,
  listPluginArtifactsUnderPath,
  listExpiredPluginStateSnapshots,
  listPluginKvKeys,
  markInstalledPluginRemoved,
  setInstalledPluginLastFailure,
  setInstalledPluginTrackingRange,
  setPluginKvValue,
  setPluginStateSnapshotFailed,
  upsertInstalledPlugin,
  type DbConnection,
  type PluginStateSnapshotRow,
} from "../../src/index.js";
import type { UpsertInstalledPluginInput } from "../../src/data/plugins.js";
import { createMigratedConnection } from "../../src/testing.js";

describe("normalized plugin persistence", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => db.$client.close());

  it("persists typed plugin intent and an active artifact reference", () => {
    const linearPlugin: UpsertInstalledPluginInput = {
      id: "linear",
      source: "npm:bb-plugin-linear@1.2.3",
      provenance: {
        kind: "catalog",
        marketplace: "bb-community",
        entryId: "linear",
      },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.npmjs.org",
        requestedSpec: "^1.2.0",
        specKind: "range",
      },
      exactResolution: {
        kind: "npm",
        version: "1.2.3",
        integrity: "sha512-example",
      },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: "2.0.0",
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/linear",
      version: "1.2.3",
      enabled: true,
      enabledFollowsDefault: false,
    };
    upsertInstalledPlugin(db, linearPlugin);
    createPluginArtifact(db, {
      id: "artifact-1",
      pluginId: "linear",
      sourceKind: "npm",
      npmResolvedVersion: "1.2.3",
      gitResolvedCommit: null,
      gitCheckoutRoot: null,
      path: "/cache/artifact-1.tgz",
      integrity: "sha512-example",
      contentHash: "sha256-example",
      validationResult: "valid",
      validatedAt: 100,
    });
    upsertInstalledPlugin(db, { ...linearPlugin, activeArtifactId: "artifact-1" });
    expect(getInstalledPlugin(db, "linear")?.rootDir).toBe(
      "/cache/artifact-1.tgz",
    );

    expect(getInstalledPluginRegistration(db, "linear")).toMatchObject({
      provenance: "catalog",
      catalogEntryId: "linear",
      catalogMarketplaceName: "bb-community",
      sourceKind: "npm",
      sourceNpmRequestedSpec: "^1.2.0",
      sourceNpmSpecKind: "range",
      npmResolvedVersion: "1.2.3",
      activeArtifactId: "artifact-1",
    });
    expect(listPluginArtifacts(db, "linear")).toHaveLength(1);
    expect(deletePluginArtifact(db, "artifact-1")).toBe(true);
    expect(getInstalledPluginRegistration(db, "linear")?.activeArtifactId).toBe(
      null,
    );
  });

  it("rejects an npm artifact without registry integrity at runtime", () => {
    const invalidArtifact = {
      id: "artifact-invalid",
      pluginId: "missing",
      sourceKind: "npm",
      npmResolvedVersion: "1.2.3",
      gitResolvedCommit: null,
      path: "/cache/artifact-invalid.tgz",
      integrity: null,
      contentHash: null,
      validationResult: "pending",
      validatedAt: null,
    };
    expect(() =>
      Reflect.apply(createPluginArtifact, undefined, [db, invalidArtifact]),
    ).toThrow(/resolution fields/);
  });

  it("stores a git ref and a git tag range in mutually exclusive columns", () => {
    const common = {
      provenance: { kind: "direct" } as const,
      exactResolution: { kind: "git" as const, commit: "abcdef1234567" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.4.2",
      enabled: true,
      enabledFollowsDefault: false,
    };
    upsertInstalledPlugin(db, {
      ...common,
      id: "ranged",
      source: "git:/repo@semver:notes/:^1.0.0",
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: "plugins/notes",
        selector: {
          kind: "range",
          range: "^1.0.0",
          tagPrefix: "notes/",
          resolvedTag: "notes/v1.4.2",
        },
      },
    });
    expect(getInstalledPlugin(db, "ranged")).toMatchObject({
      sourceGitRange: "^1.0.0",
      sourceGitTagPrefix: "notes/",
      sourceGitResolvedTag: "notes/v1.4.2",
      sourceGitRequestedRef: null,
      sourceGitRefKind: null,
    });

    upsertInstalledPlugin(db, {
      ...common,
      id: "ranged",
      source: "git:/repo@main",
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: "plugins/notes",
        selector: { kind: "ref", ref: "main", refKind: "branch" },
      },
    });
    expect(getInstalledPlugin(db, "ranged")).toMatchObject({
      sourceGitRange: null,
      sourceGitTagPrefix: null,
      sourceGitResolvedTag: null,
      sourceGitRequestedRef: "main",
      sourceGitRefKind: "branch",
    });
  });

  it("retains artifact records when a plugin registration is removed", () => {
    const retainedPlugin: UpsertInstalledPluginInput = {
      id: "retained",
      source: "git:/repo@main",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        selector: { kind: "ref", ref: "main", refKind: "branch" },
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.0.0",
      enabled: true,
      enabledFollowsDefault: false,
    };
    upsertInstalledPlugin(db, retainedPlugin);
    createPluginArtifact(db, {
      id: "retained-artifact",
      pluginId: "retained",
      sourceKind: "git",
      npmResolvedVersion: null,
      gitResolvedCommit: "abcdef1234567",
      gitCheckoutRoot: "/cache/repo/abcdef1234567",
      path: "/cache/repo/abcdef1234567",
      integrity: null,
      contentHash: "sha256:retained",
      validationResult: "valid",
      validatedAt: Date.now(),
    });
    upsertInstalledPlugin(db, { ...retainedPlugin, activeArtifactId: "retained-artifact" });

    expect(deleteInstalledPlugin(db, "retained")).toBe(true);
    expect(listPluginArtifacts(db, "retained")).toHaveLength(1);
  });

  it("matches LIKE metacharacters in key and path prefixes literally", () => {
    for (const key of ["a_b/1", "axb/2", "50%/3", "50x/4", "c\\d/5", "cxd/6"]) {
      setPluginKvValue(db, "kv-plugin", key, "value");
    }
    expect(listPluginKvKeys(db, "kv-plugin", "a_b")).toEqual(["a_b/1"]);
    expect(listPluginKvKeys(db, "kv-plugin", "50%")).toEqual(["50%/3"]);
    expect(listPluginKvKeys(db, "kv-plugin", "c\\")).toEqual(["c\\d/5"]);

    for (const [id, path] of [
      ["root", "/cache/a_b"],
      ["child", "/cache/a_b/child"],
      ["sibling", "/cache/axb/child"],
    ] as const) {
      createPluginArtifact(db, {
        id,
        pluginId: "path-plugin",
        sourceKind: "npm",
        npmResolvedVersion: "1.0.0",
        gitResolvedCommit: null,
        gitCheckoutRoot: null,
        path,
        integrity: "sha512-example",
        contentHash: null,
        validationResult: "valid",
        validatedAt: 100,
      });
    }
    expect(
      listPluginArtifactsUnderPath(db, "/cache/a_b", "/").map(({ id }) => id),
    ).toEqual(["child"]);
    expect(
      listPluginArtifactsAtOrUnderPath(db, "/cache/a_b", "/").map(
        ({ id }) => id,
      ),
    ).toEqual(["root", "child"]);
  });
});

describe("plugin tracking range changes", () => {
  let db: DbConnection;
  const checked = {
    lastCheckAt: 1_000,
    availableCompatibleVersion: "abc1230000000",
    newestIncompatibleVersion: "def4560000000",
    statusDetail: '{"id":"notes","outcome":"update-available"}',
  };

  beforeEach(() => {
    db = createMigratedConnection();
    upsertInstalledPlugin(db, {
      id: "notes",
      source: "git:/repo@semver:notes/:^0.1.0",
      provenance: { kind: "catalog", marketplace: "acme", entryId: "notes" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: "plugins/notes",
        selector: {
          kind: "range",
          range: "^0.1.0",
          tagPrefix: "notes/",
          resolvedTag: "notes/v0.1.0",
        },
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updateState: checked,
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567/plugins/notes",
      version: "0.1.0",
      enabled: false,
      enabledFollowsDefault: false,
    });
    setInstalledPluginLastFailure(db, "notes", {
      version: "abc1230000000",
      detail: "activation failed",
      at: 2_000,
    });
  });

  afterEach(() => db.$client.close());

  it("rewrites only the source and range of a git range row and clears its update state", () => {
    const before = getInstalledPluginRegistration(db, "notes");

    expect(
      setInstalledPluginTrackingRange(db, "notes", {
        sourceKind: "git",
        expectedSource: "git:/repo@semver:notes/:^0.1.0",
        source: "git:/repo@semver:notes/:>=0.1.0 <1.0.0",
        range: ">=0.1.0 <1.0.0",
      }),
    ).toBe(true);

    expect(getInstalledPluginRegistration(db, "notes")).toEqual({
      ...before,
      source: "git:/repo@semver:notes/:>=0.1.0 <1.0.0",
      sourceGitRange: ">=0.1.0 <1.0.0",
      lastUpdateCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      updateStatusDetail: null,
      lastFailureVersion: null,
      lastFailureAt: null,
      lastFailureDetail: null,
      updatedAt: expect.any(Number),
    });
  });

  it("refuses a stale expected source, a git ref row, and a removed row", () => {
    expect(
      setInstalledPluginTrackingRange(db, "notes", {
        sourceKind: "git",
        expectedSource: "git:/repo@semver:notes/:^0.2.0",
        source: "git:/repo@semver:notes/:^0.3.0",
        range: "^0.3.0",
      }),
    ).toBe(false);

    upsertInstalledPlugin(db, {
      id: "branch",
      source: "git:/repo@main",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        selector: { kind: "ref", ref: "main", refKind: "branch" },
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updateState: checked,
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.0.0",
      enabled: true,
      enabledFollowsDefault: false,
    });
    expect(
      setInstalledPluginTrackingRange(db, "branch", {
        sourceKind: "git",
        expectedSource: "git:/repo@main",
        source: "git:/repo@semver:^1.0.0",
        range: "^1.0.0",
      }),
    ).toBe(false);
    expect(getInstalledPluginRegistration(db, "branch")).toMatchObject({
      source: "git:/repo@main",
      sourceGitRange: null,
      sourceGitRequestedRef: "main",
    });

    markInstalledPluginRemoved(db, "notes");
    expect(
      setInstalledPluginTrackingRange(db, "notes", {
        sourceKind: "git",
        expectedSource: "git:/repo@semver:notes/:^0.1.0",
        source: "git:/repo@semver:notes/:^0.3.0",
        range: "^0.3.0",
      }),
    ).toBe(false);
    expect(getInstalledPluginRegistration(db, "notes")).toMatchObject({
      source: "git:/repo@semver:notes/:^0.1.0",
      sourceGitRange: "^0.1.0",
    });
  });

  it("turns any npm spec into a range spec", () => {
    upsertInstalledPlugin(db, {
      id: "linear",
      source: "npm:bb-plugin-linear@1.2.3",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.npmjs.org",
        requestedSpec: "1.2.3",
        specKind: "exact",
      },
      exactResolution: {
        kind: "npm",
        version: "1.2.3",
        integrity: "sha512-example",
      },
      updateState: checked,
      activeArtifactId: null,
      rootDir: "/cache/linear",
      version: "1.2.3",
      enabled: true,
      enabledFollowsDefault: false,
    });

    expect(
      setInstalledPluginTrackingRange(db, "linear", {
        sourceKind: "npm",
        expectedSource: "npm:bb-plugin-linear@1.2.3",
        source: "npm:bb-plugin-linear@^1.2.3",
        range: "^1.2.3",
      }),
    ).toBe(true);
    expect(getInstalledPluginRegistration(db, "linear")).toMatchObject({
      source: "npm:bb-plugin-linear@^1.2.3",
      sourceNpmRequestedSpec: "^1.2.3",
      sourceNpmSpecKind: "range",
      npmResolvedVersion: "1.2.3",
      npmIntegrity: "sha512-example",
      updateStatusDetail: null,
    });
  });
});

describe("plugin state snapshot failures", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => db.$client.close());

  function snapshot(
    id: string,
    status: PluginStateSnapshotRow["status"],
  ): PluginStateSnapshotRow {
    return createPluginStateSnapshot(db, {
      id,
      pluginId: "linear",
      fromArtifactId: "artifact-old",
      toArtifactId: "artifact-new",
      snapshotPath: `/snapshots/${id}`,
      databasePath: null,
      statePath: `/snapshots/${id}/host-state.json`,
      secretsPath: null,
      registrationPath: `/snapshots/${id}/previous-registration.json`,
      status,
      operation: "update",
      rollbackCandidateVersion: null,
      rollbackSourceFingerprint: null,
      rollbackBbVersion: null,
      rollbackSdkVersion: null,
      rollbackDetail: null,
      failureDetail: null,
      createdAt: 1,
      retainedUntil: 2,
      updatedAt: 1,
    });
  }

  it("fails only a snapshot nothing was restored from, so cleanup never takes one a restore wrote from", () => {
    for (const status of ["pending", "rollback-pending", "restoring"] as const) {
      snapshot(status, status);
      setPluginStateSnapshotFailed(db, status, {
        detail: "its saved host state is missing",
        updatedAt: 3,
      });
    }

    expect(
      listExpiredPluginStateSnapshots(db, 10).map(({ id, status }) => ({
        id,
        status,
      })),
    ).toEqual([
      { id: "pending", status: "failed" },
      { id: "rollback-pending", status: "failed" },
    ]);
  });
});
