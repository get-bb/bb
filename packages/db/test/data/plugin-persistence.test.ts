import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  createPluginArtifact,
  deletePluginArtifact,
  deleteInstalledPlugin,
  deleteMarketplace,
  getInstalledPluginRegistration,
  getInstalledPlugin,
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
        specKind: "range",
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
    expect(getInstalledPlugin(db, "linear")?.rootDir).toBe(
      "/cache/artifact-1.tgz",
    );

    expect(getInstalledPluginRegistration(db, "linear")).toMatchObject({
      provenance: "marketplace",
      marketplaceId: "official",
      marketplaceEntryId: "linear",
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
      catalogJson: null,
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
      validationDetail: null,
      validatedAt: null,
    };
    expect(() =>
      Reflect.apply(createPluginArtifact, undefined, [db, invalidArtifact]),
    ).toThrow(/resolution fields/);
  });

  it("retains artifact records when a plugin registration is removed", () => {
    upsertInstalledPlugin(db, {
      id: "retained",
      source: "git:/repo@main",
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: "/repo",
        subdirectory: null,
        requestedRef: "main",
        refKind: "branch",
      },
      exactResolution: { kind: "git", commit: "abcdef1234567" },
      updatePolicy: "compatible",
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
        ignoredVersion: null,
      },
      activeArtifactId: null,
      rootDir: "/cache/repo/abcdef1234567",
      version: "1.0.0",
      enabled: true,
    });
    createPluginArtifact(db, {
      id: "retained-artifact",
      pluginId: "retained",
      sourceKind: "git",
      npmResolvedVersion: null,
      gitResolvedCommit: "abcdef1234567",
      path: "/cache/repo/abcdef1234567",
      integrity: null,
      contentHash: "sha256:retained",
      validationResult: "valid",
      validationDetail: null,
      validatedAt: Date.now(),
    });
    expect(setInstalledPluginActiveArtifact(db, "retained", "retained-artifact")).toBe(true);

    expect(deleteInstalledPlugin(db, "retained")).toBe(true);
    expect(listPluginArtifacts(db, "retained")).toHaveLength(1);
  });
});
