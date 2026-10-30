import {
  findPluginRollbackSnapshot,
  getInstalledPlugin,
  getPluginArtifact,
  listRetainedPluginRollbackSnapshots,
  type InstalledPluginRow,
  type PluginArtifactRow,
  type PluginExactResolution,
  type PluginSourceIntent,
  type PluginStateSnapshotRow,
} from "@bb/db";
import type {
  PluginRollbackPoint,
  PluginRollbackPointResponse,
  PluginRollbackRequest,
} from "@bb/server-contract";
import { hashInstallDir, realPathInside } from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
import {
  PluginActivationRolledBackError,
  type PluginRollbackActivation,
} from "./plugin-activation.js";
import {
  pluginArtifactStorageRoot,
  removeUnusedPluginArtifacts,
} from "./plugin-artifact-gc.js";
import type { SafeModeActivationRefusalArgs } from "./plugin-runtime.js";
import type {
  PluginRollbackOutcome,
  PluginServiceDeps,
} from "./plugin-service-internal.js";
import {
  pluginRestoreHoldRefusal,
  readPluginSnapshotRegistration,
} from "./plugin-state-snapshot.js";
import {
  evaluateCompatibility,
  type PluginResolvedUpdateVersion,
} from "./update-resolver.js";

interface ResolvedRollbackPoint {
  snapshot: PluginStateSnapshotRow;
  artifact: PluginArtifactRow;
  registration: InstalledPluginRow;
  target: PluginResolvedUpdateVersion;
}

type RollbackPointLookup =
  | { outcome: "found"; point: ResolvedRollbackPoint }
  | { outcome: "none"; detail: string };

function rollbackRegistration(
  current: InstalledPluginRow,
  previous: InstalledPluginRow,
): InstalledPluginRow | null {
  if (
    previous.id !== current.id ||
    previous.sourceKind !== current.sourceKind ||
    previous.sourceGitUrl !== current.sourceGitUrl ||
    previous.sourceGitSubdirectory !== current.sourceGitSubdirectory ||
    previous.sourceGitRequestedRef !== current.sourceGitRequestedRef ||
    (previous.sourceGitRange === null) !== (current.sourceGitRange === null) ||
    previous.sourceNpmPackage !== current.sourceNpmPackage ||
    previous.sourceNpmRegistry !== current.sourceNpmRegistry
  ) {
    return null;
  }
  return {
    ...previous,
    source: current.source,
    sourceGitRange: current.sourceGitRange,
    sourceNpmRequestedSpec: current.sourceNpmRequestedSpec,
    sourceNpmSpecKind: current.sourceNpmSpecKind,
    enabled: current.enabled,
    enabledFollowsDefault: current.enabledFollowsDefault,
  };
}

interface KeptRelease {
  registration: InstalledPluginRow;
  bbRange: string | undefined;
  sdkRange: string | undefined;
}

async function keptManifestDir(
  artifact: PluginArtifactRow,
  registration: InstalledPluginRow,
): Promise<string> {
  return artifact.sourceKind === "git" && artifact.gitCheckoutRoot !== null
    ? realPathInside(
        artifact.gitCheckoutRoot,
        artifact.path,
        "git plugin subdirectory",
        registration.sourceGitSubdirectory === null,
      )
    : artifact.path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginRollbackPoints(context: {
  deps: PluginServiceDeps;
  now: () => number;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
}) {
  const { deps, now, installedUpdateVersion } = context;
  const keptReleases = new Map<string, KeptRelease>();

  async function readKeptRelease(
    artifact: PluginArtifactRow,
    registration: InstalledPluginRow,
  ): Promise<KeptRelease> {
    const manifest = await readPluginManifest(
      await keptManifestDir(artifact, registration),
    );
    return {
      registration,
      bbRange: manifest.bbEngineRange,
      sdkRange: manifest.bbPluginSdkRange,
    };
  }

  async function remember(
    snapshot: PluginStateSnapshotRow,
    registration: InstalledPluginRow,
  ): Promise<void> {
    const artifact =
      snapshot.fromArtifactId === null
        ? undefined
        : getPluginArtifact(deps.db, snapshot.fromArtifactId);
    if (artifact === undefined) return;
    try {
      keptReleases.set(
        snapshot.id,
        await readKeptRelease(artifact, registration),
      );
    } catch (error) {
      deps.logger.warn(
        `plugin rollback snapshot ${snapshot.id} has an unreadable kept release: ${errorMessage(error)}`,
      );
    }
  }

  async function load(): Promise<void> {
    for (const snapshot of listRetainedPluginRollbackSnapshots(
      deps.db,
      now(),
    )) {
      if (keptReleases.has(snapshot.id)) continue;
      try {
        await remember(
          snapshot,
          await readPluginSnapshotRegistration({
            db: deps.db,
            snapshotId: snapshot.id,
          }),
        );
      } catch (error) {
        deps.logger.warn(
          `plugin rollback snapshot ${snapshot.id} is unreadable: ${errorMessage(error)}`,
        );
      }
    }
  }

  function candidate(row: InstalledPluginRow) {
    if (
      (row.sourceKind !== "git" && row.sourceKind !== "npm") ||
      row.activeArtifactId === null
    ) {
      return undefined;
    }
    return findPluginRollbackSnapshot(deps.db, {
      pluginId: row.id,
      activeArtifactId: row.activeArtifactId,
      now: now(),
    });
  }

  function noRollbackPoint(row: InstalledPluginRow, reason: string) {
    return {
      outcome: "none" as const,
      detail: `plugin "${row.id}" has no rollback point: ${reason}`,
    };
  }

  function lookupFor(
    row: InstalledPluginRow,
    found: {
      snapshot: PluginStateSnapshotRow;
      artifact: PluginArtifactRow | null;
    },
    previous: InstalledPluginRow,
  ): RollbackPointLookup {
    const registration = rollbackRegistration(row, previous);
    if (registration === null) {
      return noRollbackPoint(
        row,
        `its source changed since the update (${previous.source} → ${row.source})`,
      );
    }
    let target: PluginResolvedUpdateVersion;
    try {
      target = installedUpdateVersion(registration);
    } catch (error) {
      return noRollbackPoint(
        row,
        `its rollback snapshot is unreadable: ${errorMessage(error)}`,
      );
    }
    if (
      found.artifact === null ||
      found.artifact.pluginId !== row.id ||
      found.artifact.validationResult !== "valid" ||
      registration.activeArtifactId !== found.artifact.id
    ) {
      return noRollbackPoint(
        row,
        `bb no longer keeps the release the update replaced (${target.display})`,
      );
    }
    return {
      outcome: "found",
      point: {
        snapshot: found.snapshot,
        artifact: found.artifact,
        registration,
        target,
      },
    };
  }

  function incompatibility(
    row: InstalledPluginRow,
    point: ResolvedRollbackPoint,
    kept: KeptRelease,
  ): RollbackPointLookup | null {
    const problems = evaluateCompatibility({
      bbRange: kept.bbRange,
      sdkRange: kept.sdkRange,
      appVersion: deps.appVersion,
    }).effective;
    if (problems.length === 0) return null;
    return noRollbackPoint(
      row,
      `${point.target.display} is incompatible with this bb: ${problems.map((problem) => problem.message).join("; ")}`,
    );
  }

  function find(row: InstalledPluginRow): PluginRollbackPoint | undefined {
    const found = candidate(row);
    if (found === undefined) return undefined;
    const kept = keptReleases.get(found.snapshot.id);
    if (kept === undefined) return undefined;
    const lookup = lookupFor(row, found, kept.registration);
    if (lookup.outcome === "none") return undefined;
    if (incompatibility(row, lookup.point, kept) !== null) return undefined;
    return {
      version: lookup.point.target.version,
      label: lookup.point.target.label,
      display: lookup.point.target.display,
      until: lookup.point.snapshot.retainedUntil,
    };
  }

  async function resolve(
    row: InstalledPluginRow,
  ): Promise<RollbackPointLookup> {
    const found = candidate(row);
    if (found === undefined) {
      return noRollbackPoint(
        row,
        "no update to its current version is still within the rollback window",
      );
    }
    let kept = keptReleases.get(found.snapshot.id);
    let previous = kept?.registration;
    if (previous === undefined) {
      try {
        previous = await readPluginSnapshotRegistration({
          db: deps.db,
          snapshotId: found.snapshot.id,
        });
      } catch (error) {
        return noRollbackPoint(
          row,
          `its rollback snapshot is unreadable: ${errorMessage(error)}`,
        );
      }
    }
    const lookup = lookupFor(row, found, previous);
    if (lookup.outcome === "none") return lookup;
    if (kept === undefined) {
      try {
        kept = await readKeptRelease(lookup.point.artifact, previous);
      } catch (error) {
        return noRollbackPoint(
          row,
          `the kept copy of ${lookup.point.target.display} is unreadable: ${errorMessage(error)}`,
        );
      }
      keptReleases.set(found.snapshot.id, kept);
    }
    return incompatibility(row, lookup.point, kept) ?? lookup;
  }

  function prune(): void {
    const retained = new Set(
      listRetainedPluginRollbackSnapshots(deps.db, now()).map(({ id }) => id),
    );
    for (const snapshotId of keptReleases.keys()) {
      if (!retained.has(snapshotId)) keptReleases.delete(snapshotId);
    }
  }

  return { find, load, prune, remember, resolve };
}

export type PluginRollbackPoints = ReturnType<
  typeof createPluginRollbackPoints
>;

interface PluginRollbackContext {
  deps: PluginServiceDeps;
  now: () => number;
  registrationMutationKey: string;
  withPluginOperationLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  withArtifactLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  safeModeActivationRefusal: (
    args: SafeModeActivationRefusalArgs,
  ) => string | null;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
  sourceIntentForRow: (row: InstalledPluginRow) => PluginSourceIntent;
  exactResolutionForRow: (row: InstalledPluginRow) => PluginExactResolution;
  rollbackPoints: PluginRollbackPoints;
  activateManagedUpdate: (args: {
    row: InstalledPluginRow;
    rootDir: string;
    manifest: PluginManifest;
    source: string;
    sourceIntent: PluginSourceIntent;
    exactResolution: PluginExactResolution;
    artifactId: string;
    rollback?: PluginRollbackActivation;
  }) => Promise<void>;
  runArtifactGc: () => Promise<void>;
  checkInBackground: (rows: InstalledPluginRow[]) => void;
}

function rollbackSourceRefusal(row: InstalledPluginRow): string | null {
  if (row.sourceKind === "path") {
    return `plugin "${row.id}" is a local path source; bb runs it from ${row.sourcePath ?? row.rootDir} and keeps no earlier release to roll back to`;
  }
  if (row.sourceKind === "builtin") {
    return `plugin "${row.id}" is included with bb and changes only when bb does; there is no earlier plugin release to roll back to`;
  }
  return null;
}

function artifactLockKey(artifact: PluginArtifactRow): string {
  return artifact.sourceKind === "git"
    ? (artifact.gitCheckoutRoot ?? artifact.path)
    : (pluginArtifactStorageRoot(artifact) ?? artifact.path);
}

export function createPluginRollback(context: PluginRollbackContext) {
  const {
    deps,
    now,
    registrationMutationKey: REGISTRATION_MUTATION_KEY,
    withPluginOperationLock,
    withArtifactLock,
    safeModeActivationRefusal,
    installedUpdateVersion,
    sourceIntentForRow,
    exactResolutionForRow,
    rollbackPoints,
    activateManagedUpdate,
    runArtifactGc,
    checkInBackground,
  } = context;

  async function readRollbackManifest(
    point: ResolvedRollbackPoint,
  ): Promise<{ manifest: PluginManifest } | { refusal: string }> {
    const { artifact, target } = point;
    const contentRoot =
      artifact.sourceKind === "git"
        ? artifact.path
        : pluginArtifactStorageRoot(artifact);
    const contentHash =
      contentRoot === null
        ? null
        : await hashInstallDir(contentRoot).catch(() => null);
    if (artifact.contentHash === null || contentHash !== artifact.contentHash) {
      return {
        refusal: `rollback refused: the copy of ${target.display} that bb kept changed or is incomplete on disk; update the plugin instead`,
      };
    }
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(
        await keptManifestDir(artifact, point.registration),
      );
    } catch (error) {
      return {
        refusal: `rollback refused: the kept copy of ${target.display} is unreadable: ${errorMessage(error)}`,
      };
    }
    if (manifest.id !== point.registration.id) {
      return {
        refusal: `rollback refused: the kept copy of ${target.display} declares plugin id "${manifest.id}"`,
      };
    }
    return { manifest };
  }

  function getRollbackPoint(id: string): Promise<PluginRollbackPointResponse> {
    return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
      const row = getInstalledPlugin(deps.db, id);
      if (row === undefined) {
        return { outcome: "unavailable", detail: `unknown plugin "${id}"` };
      }
      const sourceRefusal = rollbackSourceRefusal(row);
      if (sourceRefusal !== null) {
        return { outcome: "unavailable", detail: sourceRefusal };
      }
      const holdRefusal = pluginRestoreHoldRefusal(deps.db, id, "rollback");
      if (holdRefusal !== null) {
        return { outcome: "unavailable", detail: holdRefusal };
      }
      const lookup = await rollbackPoints.resolve(row);
      if (lookup.outcome === "none") {
        return { outcome: "unavailable", detail: lookup.detail };
      }
      return {
        outcome: "rollback-available",
        from: installedUpdateVersion(row),
        point: {
          version: lookup.point.target.version,
          label: lookup.point.target.label,
          display: lookup.point.target.display,
          until: lookup.point.snapshot.retainedUntil,
        },
      };
    });
  }

  async function revert(
    id: string,
    request: PluginRollbackRequest,
  ): Promise<PluginRollbackOutcome> {
    return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
      const row = getInstalledPlugin(deps.db, id);
      if (row === undefined) {
        return { ok: false, error: `unknown plugin "${id}"` };
      }
      const sourceRefusal = rollbackSourceRefusal(row);
      if (sourceRefusal !== null) return { ok: false, error: sourceRefusal };
      const holdRefusal = pluginRestoreHoldRefusal(deps.db, id, "rollback");
      if (holdRefusal !== null) return { ok: false, error: holdRefusal };
      const safeModeRefusal = safeModeActivationRefusal({
        pluginId: id,
        provenance: row.provenance,
        builtinName: null,
        action: "roll back",
      });
      if (safeModeRefusal !== null) {
        return { ok: false, error: safeModeRefusal };
      }
      const lookup = await rollbackPoints.resolve(row);
      if (lookup.outcome === "none") return { ok: false, error: lookup.detail };
      const { point } = lookup;
      const from = installedUpdateVersion(row);
      if (
        request.expectedVersion !== undefined &&
        request.expectedVersion !== point.target.version
      ) {
        return {
          ok: false,
          error: `rollback refused: expected ${request.expectedVersion}, but the rollback point is now ${point.target.display}; review the plugin again`,
        };
      }
      let refusal: string | null;
      try {
        refusal = await withArtifactLock(
          artifactLockKey(point.artifact),
          async () => {
            const prepared = await readRollbackManifest(point);
            if ("refusal" in prepared) return prepared.refusal;
            await activateManagedUpdate({
              row,
              rootDir: point.artifact.path,
              manifest: prepared.manifest,
              source: point.registration.source,
              sourceIntent: sourceIntentForRow(point.registration),
              exactResolution: exactResolutionForRow(point.registration),
              artifactId: point.artifact.id,
              rollback: { snapshot: point.snapshot },
            });
            return null;
          },
        );
      } catch (error) {
        if (error instanceof PluginActivationRolledBackError) {
          return {
            ok: true,
            result: {
              applied: false,
              from,
              to: point.target,
              outcome: "rolled-back",
              detail: error.message,
            },
          };
        }
        throw error;
      }
      if (refusal !== null) return { ok: false, error: refusal };
      await removeUnusedPluginArtifacts({
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        now: now(),
        warn: (message) => deps.logger.warn(message),
      });
      await runArtifactGc();
      return {
        ok: true,
        result: { applied: true, from, to: point.target, outcome: "reverted" },
      };
    });
  }

  async function rollbackUpdate(
    id: string,
    request: PluginRollbackRequest = {},
  ): Promise<PluginRollbackOutcome> {
    const outcome = await revert(id, request);
    if (outcome.ok && outcome.result.outcome === "reverted") {
      const row = getInstalledPlugin(deps.db, id);
      if (row !== undefined) checkInBackground([row]);
    }
    return outcome;
  }

  return { getRollbackPoint, rollbackUpdate };
}
