import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countAppliedMigrations,
  createConnection,
  createPluginArtifact,
  createPluginStateSnapshot,
  getHost,
  listPathInstalledPluginSources,
  listPluginArtifacts,
  listPluginMarketplaces,
  listPluginStateSnapshots,
  markInstalledPluginRemoved,
  noopNotifier,
  rerootServerOwnedPluginPaths,
  swapServerHostRoles,
  updateHost,
  upsertHost,
  upsertInstalledPlugin,
  upsertPluginMarketplace,
  type DbConnection,
} from "../../src/index.js";
import type { UpsertInstalledPluginInput } from "../../src/data/plugins.js";
import { installedPlugins } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

const SOURCE_ROOT = "/home/me/.bb";
const TARGET_ROOT = "/home/me/.bb-machines/old-server";

function pathPlugin(
  id: string,
  sourcePath: string,
  rootDir: string,
): UpsertInstalledPluginInput {
  return {
    id,
    source: `path:${sourcePath}`,
    provenance: { kind: "direct" },
    sourceIntent: { kind: "path", canonicalPath: sourcePath },
    exactResolution: { kind: "path" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir,
    version: "1.0.0",
    enabled: true,
  };
}

function seedPluginPaths(db: DbConnection): void {
  upsertInstalledPlugin(
    db,
    pathPlugin(
      "server-owned",
      `${SOURCE_ROOT}/plugins/local-copy`,
      `${SOURCE_ROOT}/plugins/local-copy`,
    ),
  );
  upsertInstalledPlugin(
    db,
    pathPlugin(
      "sibling-prefix",
      "/home/me/.bb-machines/other/plugin",
      "/home/me/.bb-machines/other/plugin",
    ),
  );
  upsertInstalledPlugin(
    db,
    pathPlugin("outside", "/home/me/code/plugin", "/home/me/code/plugin"),
  );
  createPluginArtifact(db, {
    id: "artifact-git",
    pluginId: "server-owned",
    sourceKind: "git",
    npmResolvedVersion: null,
    gitResolvedCommit: "abc123",
    gitCheckoutRoot: `${SOURCE_ROOT}/plugins/cache/git/abc123`,
    path: `${SOURCE_ROOT}/plugins/cache/git/abc123/plugin`,
    integrity: null,
    contentHash: null,
    validationResult: "valid",
    validatedAt: 1,
  });
  createPluginArtifact(db, {
    id: "artifact-outside",
    pluginId: "outside",
    sourceKind: "npm",
    npmResolvedVersion: "1.0.0",
    gitResolvedCommit: null,
    gitCheckoutRoot: null,
    path: "/var/cache/bb/artifact.tgz",
    integrity: "sha512-x",
    contentHash: null,
    validationResult: "valid",
    validatedAt: 1,
  });
  createPluginStateSnapshot(db, {
    id: "snapshot-1",
    pluginId: "server-owned",
    fromArtifactId: null,
    toArtifactId: "artifact-git",
    snapshotPath: `${SOURCE_ROOT}/plugins/snapshots/server-owned/1`,
    databasePath: `${SOURCE_ROOT}/plugins/snapshots/server-owned/1/data.db`,
    statePath: `${SOURCE_ROOT}/plugins/snapshots/server-owned/1/host-state.json`,
    secretsPath: null,
    registrationPath: `${SOURCE_ROOT}/plugins/snapshots/server-owned/1/previous-registration.json`,
    status: "ready",
    rollbackCandidateVersion: null,
    rollbackSourceFingerprint: null,
    rollbackBbVersion: null,
    rollbackSdkVersion: null,
    rollbackDetail: null,
    createdAt: 1,
    retainedUntil: 2,
    updatedAt: 1,
  });
  for (const [name, sourceKind, manifestUrl] of [
    ["local-path", "path", `${SOURCE_ROOT}/marketplaces/local`],
    ["https-lookalike", "https", `${SOURCE_ROOT}/marketplaces/not-a-path`],
    ["bundled", "path", "/opt/bb-app/plugins"],
  ] as const) {
    upsertPluginMarketplace(db, {
      name,
      sourceKind,
      manifestUrl,
      sourceGitRef: null,
      sourceGitCommit: null,
      manifestJson: "{}",
      statsJson: null,
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: null,
      lastError: null,
    });
  }
}

function pluginPaths(db: DbConnection) {
  return db
    .select({
      id: installedPlugins.id,
      rootDir: installedPlugins.rootDir,
      sourcePath: installedPlugins.sourcePath,
    })
    .from(installedPlugins)
    .all()
    .sort((left, right) => left.id.localeCompare(right.id));
}

describe("server move data helpers", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => db.$client.close());

  it("re-roots only server-owned plugin paths under the source data dir", () => {
    seedPluginPaths(db);

    const result = rerootServerOwnedPluginPaths(db, {
      fromRoot: SOURCE_ROOT,
      toRoot: TARGET_ROOT,
    });

    expect(result).toEqual({
      plugins: 2,
      pluginArtifacts: 2,
      pluginStateSnapshots: 4,
      pluginMarketplaces: 1,
    });
    expect(pluginPaths(db)).toEqual([
      {
        id: "outside",
        rootDir: "/home/me/code/plugin",
        sourcePath: "/home/me/code/plugin",
      },
      {
        id: "server-owned",
        rootDir: `${TARGET_ROOT}/plugins/local-copy`,
        sourcePath: `${TARGET_ROOT}/plugins/local-copy`,
      },
      {
        id: "sibling-prefix",
        rootDir: "/home/me/.bb-machines/other/plugin",
        sourcePath: "/home/me/.bb-machines/other/plugin",
      },
    ]);
    expect(
      listPluginArtifacts(db, "server-owned").map((artifact) => ({
        path: artifact.path,
        gitCheckoutRoot: artifact.gitCheckoutRoot,
      })),
    ).toEqual([
      {
        path: `${TARGET_ROOT}/plugins/cache/git/abc123/plugin`,
        gitCheckoutRoot: `${TARGET_ROOT}/plugins/cache/git/abc123`,
      },
    ]);
    expect(listPluginArtifacts(db, "outside")[0]?.path).toBe(
      "/var/cache/bb/artifact.tgz",
    );
    expect(listPluginStateSnapshots(db, "server-owned")[0]).toMatchObject({
      snapshotPath: `${TARGET_ROOT}/plugins/snapshots/server-owned/1`,
      databasePath: `${TARGET_ROOT}/plugins/snapshots/server-owned/1/data.db`,
      statePath: `${TARGET_ROOT}/plugins/snapshots/server-owned/1/host-state.json`,
      secretsPath: null,
      registrationPath: `${TARGET_ROOT}/plugins/snapshots/server-owned/1/previous-registration.json`,
    });
    expect(
      Object.fromEntries(
        listPluginMarketplaces(db).map((row) => [row.name, row.manifestUrl]),
      ),
    ).toMatchObject({
      "local-path": `${TARGET_ROOT}/marketplaces/local`,
      "https-lookalike": `${SOURCE_ROOT}/marketplaces/not-a-path`,
      bundled: "/opt/bb-app/plugins",
    });

    expect(
      rerootServerOwnedPluginPaths(db, {
        fromRoot: SOURCE_ROOT,
        toRoot: TARGET_ROOT,
      }),
    ).toEqual({
      plugins: 0,
      pluginArtifacts: 0,
      pluginStateSnapshots: 0,
      pluginMarketplaces: 0,
    });
  });

  it("stays idempotent when the target root is nested inside the source root", () => {
    const nestedTarget = `${SOURCE_ROOT}/imported`;
    upsertInstalledPlugin(
      db,
      pathPlugin(
        "server-owned",
        `${SOURCE_ROOT}/plugins/local-copy`,
        `${SOURCE_ROOT}/plugins/local-copy`,
      ),
    );

    rerootServerOwnedPluginPaths(db, {
      fromRoot: SOURCE_ROOT,
      toRoot: nestedTarget,
    });
    rerootServerOwnedPluginPaths(db, {
      fromRoot: SOURCE_ROOT,
      toRoot: nestedTarget,
    });

    expect(pluginPaths(db)).toEqual([
      {
        id: "server-owned",
        rootDir: `${nestedTarget}/plugins/local-copy`,
        sourcePath: `${nestedTarget}/plugins/local-copy`,
      },
    ]);
  });

  it("swaps host roles once and leaves provider-managed targets alone", () => {
    const now = 5_000;
    upsertHost(db, noopNotifier, { id: "old-server", name: "Laptop" });
    upsertHost(db, noopNotifier, { id: "target", name: "Desktop" });
    upsertHost(db, noopNotifier, { id: "cloud", name: "Cloud VM" });
    updateHost(db, noopNotifier, "target", {
      machineProviderId: "manual",
      resource: { version: 1, hostId: "target" },
    });
    updateHost(db, noopNotifier, "cloud", {
      machineProviderId: "digitalocean",
      resource: { dropletId: 1 },
    });

    expect(
      swapServerHostRoles(db, {
        targetHostId: "target",
        sourceServerHostId: "old-server",
        now,
      }),
    ).toEqual({ targetHostBecameServer: true, sourceServerHostBecameManual: true });
    expect(getHost(db, "target")).toMatchObject({
      machineProviderId: null,
      resource: null,
    });
    expect(getHost(db, "old-server")).toMatchObject({
      machineProviderId: "manual",
      resource: { version: 1, hostId: "old-server" },
      updatedAt: now,
    });
    expect(
      swapServerHostRoles(db, {
        targetHostId: "target",
        sourceServerHostId: "old-server",
        now,
      }),
    ).toEqual({
      targetHostBecameServer: false,
      sourceServerHostBecameManual: false,
    });

    expect(
      swapServerHostRoles(db, {
        targetHostId: "cloud",
        sourceServerHostId: null,
        now,
      }),
    ).toEqual({
      targetHostBecameServer: false,
      sourceServerHostBecameManual: false,
    });
    expect(getHost(db, "cloud")).toMatchObject({
      machineProviderId: "digitalocean",
      resource: { dropletId: 1 },
    });
  });

  it("counts applied migrations only on migrated databases", () => {
    expect(countAppliedMigrations(db)).toBeGreaterThan(100);
    const fresh = createConnection(":memory:");
    try {
      expect(countAppliedMigrations(fresh)).toBe(0);
    } finally {
      fresh.$client.close();
    }
  });

  it("lists path-installed plugin sources that are still installed", () => {
    seedPluginPaths(db);
    markInstalledPluginRemoved(db, "sibling-prefix");

    expect(
      listPathInstalledPluginSources(db).sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    ).toEqual([
      { id: "outside", sourcePath: "/home/me/code/plugin" },
      { id: "server-owned", sourcePath: `${SOURCE_ROOT}/plugins/local-copy` },
    ]);
  });
});
