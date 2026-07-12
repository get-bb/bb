import { and, eq, isNull } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { installedPlugins } from "../schema.js";

export type PluginProvenance =
  | { kind: "builtin" }
  | { kind: "direct" }
  | { kind: "marketplace"; marketplaceId: string; entryId: string };

export type PluginSourceIntent =
  | { kind: "path"; canonicalPath: string }
  | { kind: "builtin"; name: string }
  | {
      kind: "npm";
      packageName: string;
      registry: string;
      requestedSpec: string;
      specKind: "default" | "exact" | "tag" | "range";
    }
  | {
      kind: "git";
      url: string;
      subdirectory: string | null;
      requestedRef: string;
      refKind: "branch" | "tag" | "commit";
    };

export type PluginExactResolution =
  | { kind: "path" | "builtin" }
  | { kind: "npm"; version: string; integrity: string }
  | { kind: "git"; commit: string };

export type LegacyPluginExactResolution =
  | { kind: "path" | "builtin" }
  | { kind: "npm"; version: string; integrity: string | null }
  | { kind: "git"; commit: string | null };

export type PluginUpdatePolicy = "manual" | "compatible" | "patch" | "minor";

export interface PluginUpdateState {
  lastCheckAt: number | null;
  availableCompatibleVersion: string | null;
  newestIncompatibleVersion: string | null;
  statusDetail: string | null;
  ignoredVersion: string | null;
}

export interface InstalledPluginRow {
  id: string;
  source: string;
  provenance: "builtin" | "direct" | "marketplace";
  marketplaceId: string | null;
  marketplaceEntryId: string | null;
  sourceKind: "path" | "builtin" | "npm" | "git";
  sourcePath: string | null;
  sourceBuiltinName: string | null;
  sourceNpmPackage: string | null;
  sourceNpmRegistry: string | null;
  sourceNpmRequestedSpec: string | null;
  sourceNpmSpecKind: "default" | "exact" | "tag" | "range" | null;
  sourceGitUrl: string | null;
  sourceGitSubdirectory: string | null;
  sourceGitRequestedRef: string | null;
  sourceGitRefKind: "branch" | "tag" | "commit" | null;
  npmResolvedVersion: string | null;
  npmIntegrity: string | null;
  gitResolvedCommit: string | null;
  updatePolicy: PluginUpdatePolicy;
  lastUpdateCheckAt: number | null;
  availableCompatibleVersion: string | null;
  newestIncompatibleVersion: string | null;
  updateStatusDetail: string | null;
  ignoredVersion: string | null;
  activeArtifactId: string | null;
  normalizationVersion: number;
  rootDir: string;
  version: string;
  enabled: boolean;
  removedAt: number | null;
  installedAt: number;
  updatedAt: number;
}

export interface UpsertInstalledPluginInput {
  id: string;
  source: string;
  provenance: PluginProvenance;
  sourceIntent: PluginSourceIntent;
  exactResolution: PluginExactResolution;
  updatePolicy: PluginUpdatePolicy;
  updateState: PluginUpdateState;
  activeArtifactId: string | null;
  rootDir: string;
  version: string;
  enabled: boolean;
}

export interface LegacyInstalledPluginRegistration {
  id: string;
  source: string;
  rootDir: string;
  version: string;
  enabled: boolean;
}

export type NormalizeLegacyInstalledPluginInput = Omit<
  UpsertInstalledPluginInput,
  "exactResolution"
> & { exactResolution: LegacyPluginExactResolution };

function normalizedColumns(
  plugin: UpsertInstalledPluginInput | NormalizeLegacyInstalledPluginInput,
) {
  if (plugin.sourceIntent.kind !== plugin.exactResolution.kind) {
    throw new Error(
      `plugin source intent and exact resolution kinds differ for ${plugin.id}`,
    );
  }
  return {
    provenance: plugin.provenance.kind,
    marketplaceId:
      plugin.provenance.kind === "marketplace"
        ? plugin.provenance.marketplaceId
        : null,
    marketplaceEntryId:
      plugin.provenance.kind === "marketplace" ? plugin.provenance.entryId : null,
    sourceKind: plugin.sourceIntent.kind,
    sourcePath:
      plugin.sourceIntent.kind === "path"
        ? plugin.sourceIntent.canonicalPath
        : null,
    sourceBuiltinName:
      plugin.sourceIntent.kind === "builtin" ? plugin.sourceIntent.name : null,
    sourceNpmPackage:
      plugin.sourceIntent.kind === "npm"
        ? plugin.sourceIntent.packageName
        : null,
    sourceNpmRegistry:
      plugin.sourceIntent.kind === "npm" ? plugin.sourceIntent.registry : null,
    sourceNpmRequestedSpec:
      plugin.sourceIntent.kind === "npm"
        ? plugin.sourceIntent.requestedSpec
        : null,
    sourceNpmSpecKind:
      plugin.sourceIntent.kind === "npm"
        ? plugin.sourceIntent.specKind
        : null,
    sourceGitUrl:
      plugin.sourceIntent.kind === "git" ? plugin.sourceIntent.url : null,
    sourceGitSubdirectory:
      plugin.sourceIntent.kind === "git"
        ? plugin.sourceIntent.subdirectory
        : null,
    sourceGitRequestedRef:
      plugin.sourceIntent.kind === "git"
        ? plugin.sourceIntent.requestedRef
        : null,
    sourceGitRefKind:
      plugin.sourceIntent.kind === "git" ? plugin.sourceIntent.refKind : null,
    npmResolvedVersion:
      plugin.exactResolution.kind === "npm"
        ? plugin.exactResolution.version
        : null,
    npmIntegrity:
      plugin.exactResolution.kind === "npm"
        ? plugin.exactResolution.integrity
        : null,
    gitResolvedCommit:
      plugin.exactResolution.kind === "git"
        ? plugin.exactResolution.commit
        : null,
    updatePolicy: plugin.updatePolicy,
    lastUpdateCheckAt: plugin.updateState.lastCheckAt,
    availableCompatibleVersion: plugin.updateState.availableCompatibleVersion,
    newestIncompatibleVersion: plugin.updateState.newestIncompatibleVersion,
    updateStatusDetail: plugin.updateState.statusDetail,
    ignoredVersion: plugin.updateState.ignoredVersion,
    activeArtifactId: plugin.activeArtifactId,
    normalizationVersion: 1,
  } as const;
}

export function listInstalledPlugins(db: DbConnection): InstalledPluginRow[] {
  return db
    .select()
    .from(installedPlugins)
    .where(isNull(installedPlugins.removedAt))
    .all();
}

export function getInstalledPlugin(
  db: DbConnection,
  id: string,
): InstalledPluginRow | undefined {
  return db
    .select()
    .from(installedPlugins)
    .where(and(eq(installedPlugins.id, id), isNull(installedPlugins.removedAt)))
    .get();
}

export function getInstalledPluginRegistration(
  db: DbConnection,
  id: string,
): InstalledPluginRow | undefined {
  return db.select().from(installedPlugins).where(eq(installedPlugins.id, id)).get();
}

export function listUnnormalizedPluginRegistrations(
  db: DbConnection,
): LegacyInstalledPluginRegistration[] {
  return db
    .select({
      id: installedPlugins.id,
      source: installedPlugins.source,
      rootDir: installedPlugins.rootDir,
      version: installedPlugins.version,
      enabled: installedPlugins.enabled,
    })
    .from(installedPlugins)
    .where(eq(installedPlugins.normalizationVersion, 0))
    .all();
}

export function normalizeInstalledPluginRegistration(
  db: DbConnection,
  plugin: NormalizeLegacyInstalledPluginInput,
): boolean {
  const result = db
    .update(installedPlugins)
    .set(normalizedColumns(plugin))
    .where(
      and(
        eq(installedPlugins.id, plugin.id),
        eq(installedPlugins.normalizationVersion, 0),
      ),
    )
    .run();
  return result.changes > 0;
}

export function upsertInstalledPlugin(
  db: DbConnection,
  plugin: UpsertInstalledPluginInput,
): InstalledPluginRow {
  const now = Date.now();
  const normalized = normalizedColumns(plugin);
  db.insert(installedPlugins)
    .values({
      id: plugin.id,
      source: plugin.source,
      rootDir: plugin.rootDir,
      version: plugin.version,
      enabled: plugin.enabled,
      ...normalized,
      removedAt: null,
      installedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: installedPlugins.id,
      set: {
        source: plugin.source,
        rootDir: plugin.rootDir,
        version: plugin.version,
        enabled: plugin.enabled,
        ...normalized,
        removedAt: null,
        updatedAt: now,
      },
    })
    .run();
  const row = getInstalledPlugin(db, plugin.id);
  if (!row) throw new Error(`plugin row missing after upsert: ${plugin.id}`);
  return row;
}

export function setInstalledPluginEnabled(
  db: DbConnection,
  id: string,
  enabled: boolean,
): boolean {
  const result = db
    .update(installedPlugins)
    .set({ enabled, updatedAt: Date.now() })
    .where(eq(installedPlugins.id, id))
    .run();
  return result.changes > 0;
}

export function setInstalledPluginUpdateState(
  db: DbConnection,
  id: string,
  state: PluginUpdateState,
): boolean {
  const result = db
    .update(installedPlugins)
    .set({
      lastUpdateCheckAt: state.lastCheckAt,
      availableCompatibleVersion: state.availableCompatibleVersion,
      newestIncompatibleVersion: state.newestIncompatibleVersion,
      updateStatusDetail: state.statusDetail,
      ignoredVersion: state.ignoredVersion,
      updatedAt: Date.now(),
    })
    .where(and(eq(installedPlugins.id, id), isNull(installedPlugins.removedAt)))
    .run();
  return result.changes > 0;
}

export function setInstalledPluginSourceClassification(
  db: DbConnection,
  id: string,
  classification:
    | { kind: "npm"; specKind: "default" | "exact" | "tag" | "range" }
    | { kind: "git"; refKind: "branch" | "tag" | "commit" },
): boolean {
  const values =
    classification.kind === "npm"
      ? { sourceNpmSpecKind: classification.specKind }
      : { sourceGitRefKind: classification.refKind };
  const result = db
    .update(installedPlugins)
    .set({ ...values, updatedAt: Date.now() })
    .where(
      and(
        eq(installedPlugins.id, id),
        eq(installedPlugins.sourceKind, classification.kind),
        isNull(installedPlugins.removedAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function setInstalledPluginActiveArtifact(
  db: DbConnection,
  id: string,
  activeArtifactId: string | null,
): boolean {
  const result = db
    .update(installedPlugins)
    .set({ activeArtifactId, updatedAt: Date.now() })
    .where(eq(installedPlugins.id, id))
    .run();
  return result.changes > 0;
}

export function deleteInstalledPlugin(db: DbConnection, id: string): boolean {
  const result = db
    .delete(installedPlugins)
    .where(eq(installedPlugins.id, id))
    .run();
  return result.changes > 0;
}

export function markInstalledPluginRemoved(
  db: DbConnection,
  id: string,
): boolean {
  const now = Date.now();
  const result = db
    .update(installedPlugins)
    .set({ enabled: false, removedAt: now, updatedAt: now })
    .where(eq(installedPlugins.id, id))
    .run();
  return result.changes > 0;
}
