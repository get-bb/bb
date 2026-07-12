import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  createPluginArtifact,
  deleteMarketplace,
  getInstalledPluginRegistration,
  getMarketplace,
  listPluginArtifacts,
  listMarketplaces,
  migrate,
  setInstalledPluginActiveArtifact,
  upsertInstalledPlugin,
  upsertMarketplace,
  type DbConnection,
} from "../../src/index.js";

describe("normalized plugin persistence", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => db.$client.close());

  it("persists typed plugin intent and an active artifact reference", () => {
    upsertInstalledPlugin(db, {
      id: "linear",
      source: "npm:bb-plugin-linear@1.2.3",
      provenance: {
        kind: "marketplace",
        marketplaceId: "official",
        entryId: "linear",
      },
      sourceIntent: {
        kind: "npm",
        packageName: "bb-plugin-linear",
        registry: "https://registry.npmjs.org",
        requestedSpec: "^1.2.0",
      },
      exactResolution: {
        kind: "npm",
        version: "1.2.3",
        integrity: "sha512-example",
      },
      updatePolicy: "compatible",
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: "2.0.0",
        statusDetail: null,
        ignoredVersion: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/linear",
      version: "1.2.3",
      enabled: true,
    });
    createPluginArtifact(db, {
      id: "artifact-1",
      pluginId: "linear",
      sourceKind: "npm",
      npmResolvedVersion: "1.2.3",
      gitResolvedCommit: null,
      path: "/cache/artifact-1.tgz",
      integrity: "sha512-example",
      contentHash: "sha256-example",
      validationResult: "valid",
      validationDetail: null,
      validatedAt: 100,
    });
    expect(setInstalledPluginActiveArtifact(db, "linear", "artifact-1")).toBe(
      true,
    );

    expect(getInstalledPluginRegistration(db, "linear")).toMatchObject({
      provenance: "marketplace",
      marketplaceId: "official",
      marketplaceEntryId: "linear",
      sourceKind: "npm",
      sourceNpmRequestedSpec: "^1.2.0",
      npmResolvedVersion: "1.2.3",
      activeArtifactId: "artifact-1",
    });
    expect(listPluginArtifacts(db, "linear")).toHaveLength(1);
  });

  it("upserts and lists typed marketplace state", () => {
    upsertMarketplace(db, {
      id: "official",
      displayName: "Official",
      sourceKind: "git",
      location: "https://github.com/bb/marketplace.git",
      requestedGitRef: "main",
      resolvedGitCommit: null,
      cachePath: null,
      contentHash: null,
      enabled: true,
      trusted: true,
      updatePolicy: "compatible",
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: null,
      lastError: null,
      scope: "builtin",
    });

    expect(listMarketplaces(db)).toMatchObject([
      { id: "official", sourceKind: "git", scope: "builtin", trusted: true },
    ]);
    expect(getMarketplace(db, "official")?.displayName).toBe("Official");
    expect(deleteMarketplace(db, "official")).toBe(true);
  });
});
