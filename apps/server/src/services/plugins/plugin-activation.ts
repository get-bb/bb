import { rm } from "node:fs/promises";
import { reportPluginUpdatePhase } from "./plugin-update-progress.js";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import {
  completePluginStateSnapshotRestore,
  getInstalledPlugin,
  getPluginArtifact,
  listIncompletePluginRollbackSnapshots,
  setInstalledPluginLastFailure,
  setPluginStateSnapshotFailed,
  setPluginStateSnapshotRestoreFailure,
  setPluginStateSnapshotRestoring,
  setPluginStateSnapshotRollbackApplied,
  setPluginStateSnapshotRollbackPending,
  setPluginStateSnapshotRollbackWriting,
  setPluginStateSnapshotStatus,
  upsertInstalledPlugin,
  type InstalledPluginRow,
  type PluginExactResolution,
  type PluginProvenance,
  type PluginSourceIntent,
  type PluginStateSnapshotRow,
} from "@bb/db";
import {
  applyPluginStateSnapshot,
  checkPluginStateSnapshot,
  createPluginStateSnapshotOnDisk,
  pluginRestoreHold,
  restorePluginHostStateSnapshot,
  restorePluginStateSnapshot,
} from "./plugin-state-snapshot.js";
import {
  garbageCollectPluginArtifacts,
  pluginArtifactStorageRoot,
  removePluginStateSnapshots,
} from "./plugin-artifact-gc.js";
import type { PluginRuntimeStatus } from "@bb/server-contract";
import type { PluginServiceDeps } from "./plugin-service-internal.js";
import type { PluginManifest } from "./manifest.js";

export class PluginActivationRolledBackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginActivationRolledBackError";
  }
}

export interface PluginRollbackActivation {
  snapshot: PluginStateSnapshotRow;
}

interface PluginRecovery {
  restored: PluginStateSnapshotRow | null;
  problem: string | null;
  warnings: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshotTarget(snapshot: PluginStateSnapshotRow): string {
  const version = snapshot.rollbackCandidateVersion;
  if (version === null) return "";
  return ` to ${/^[0-9a-f]{40}$/u.test(version) ? version.slice(0, 12) : version}`;
}

function recordedUpdateFailure(
  row: InstalledPluginRow,
): { version: string; detail: string; at: number } | null {
  return row.lastFailureVersion === null ||
    row.lastFailureDetail === null ||
    row.lastFailureAt === null
    ? null
    : {
        version: row.lastFailureVersion,
        detail: row.lastFailureDetail,
        at: row.lastFailureAt,
      };
}

interface PluginActivationContext {
  deps: PluginServiceDeps;
  now: () => number;
  artifactRetentionMs: number;
  stabilizationWindowMs: number;
  scheduleStabilizationWindow: (
    durationMs: number,
    onElapsed: () => void,
  ) => () => void;
  stabilizingPluginIds: Set<string>;
  statuses: Map<string, { status: PluginRuntimeStatus; detail: string | null }>;
  statusListeners: Map<
    string,
    Set<(status: PluginRuntimeStatus, detail: string | null) => void>
  >;
  withArtifactLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  withLifecycleLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  disposeOne: (id: string) => Promise<void>;
  loadOne: (row: InstalledPluginRow) => Promise<string | null>;
  loadIgnoringRestoreHold: (row: InstalledPluginRow) => Promise<string | null>;
  restoreRegistration: (row: InstalledPluginRow) => void;
  registrationProblem: (row: InstalledPluginRow) => string | null;
  provenanceForRow: (row: InstalledPluginRow) => PluginProvenance;
  registrationMatchesForActivation: (
    current: InstalledPluginRow,
    expected: InstalledPluginRow,
  ) => boolean;
  emptyPluginUpdateState: () => {
    readonly lastCheckAt: null;
    readonly availableCompatibleVersion: null;
    readonly newestIncompatibleVersion: null;
    readonly statusDetail: null;
  };
  sourceFingerprint: (row: InstalledPluginRow) => string;
  rememberRollbackPoint: (
    snapshot: PluginStateSnapshotRow,
    registration: InstalledPluginRow,
  ) => Promise<void>;
  pruneRollbackPoints: () => void;
  syncCliSkill: () => Promise<void>;
  notifyPluginsChanged: () => void;
}

export function createPluginActivation(context: PluginActivationContext) {
  const {
    deps,
    now,
    artifactRetentionMs,
    stabilizationWindowMs,
    scheduleStabilizationWindow,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    withArtifactLock,
    withLifecycleLock,
    disposeOne,
    loadOne,
    loadIgnoringRestoreHold,
    restoreRegistration,
    registrationProblem,
    provenanceForRow,
    registrationMatchesForActivation,
    emptyPluginUpdateState,
    sourceFingerprint,
    rememberRollbackPoint,
    pruneRollbackPoints,
    syncCliSkill,
    notifyPluginsChanged,
  } = context;
  const logger = deps.logger;

  function rollbackMetadata(snapshot: PluginStateSnapshotRow) {
    if (
      snapshot.rollbackCandidateVersion === null ||
      snapshot.rollbackSourceFingerprint === null ||
      snapshot.rollbackBbVersion === null ||
      snapshot.rollbackSdkVersion === null ||
      snapshot.rollbackDetail === null
    ) {
      return null;
    }
    return {
      candidateVersion: snapshot.rollbackCandidateVersion,
      sourceFingerprint: snapshot.rollbackSourceFingerprint,
      bbVersion: snapshot.rollbackBbVersion,
      sdkVersion: snapshot.rollbackSdkVersion,
      detail: snapshot.rollbackDetail,
    };
  }

  async function restoreSnapshotWithinLifecycle(
    snapshot: PluginStateSnapshotRow,
    rollback: NonNullable<ReturnType<typeof rollbackMetadata>>,
    previousRegistration: InstalledPluginRow,
  ): Promise<string | null> {
    await disposeOne(snapshot.pluginId);
    const current = getInstalledPlugin(deps.db, snapshot.pluginId);
    if (current === undefined) {
      throw new Error(
        `plugin "${snapshot.pluginId}" disappeared during rollback`,
      );
    }
    if (!setPluginStateSnapshotRestoring(deps.db, snapshot.id, now())) {
      throw new Error(`plugin rollback snapshot disappeared: ${snapshot.id}`);
    }
    restoreRegistration({
      ...previousRegistration,
      enabled: current.enabled,
      enabledFollowsDefault: current.enabledFollowsDefault,
    });
    await restorePluginStateSnapshot({
      db: deps.db,
      dataDir: deps.dataDir,
      snapshotId: snapshot.id,
    });
    await deps.afterPluginRollbackStateRestored?.({
      pluginId: snapshot.pluginId,
      snapshotId: snapshot.id,
    });
    const lastFailure =
      snapshot.operation === "update"
        ? {
            version: rollback.candidateVersion,
            detail: rollback.detail,
            at: now(),
          }
        : recordedUpdateFailure(previousRegistration);
    if (
      lastFailure !== null &&
      !setInstalledPluginLastFailure(deps.db, snapshot.pluginId, lastFailure)
    ) {
      throw new Error(
        `plugin "${snapshot.pluginId}" disappeared during rollback`,
      );
    }
    const previous = getInstalledPlugin(deps.db, snapshot.pluginId);
    const problem = previous ? await loadIgnoringRestoreHold(previous) : null;
    await restorePluginHostStateSnapshot({
      db: deps.db,
      snapshotId: snapshot.id,
    });
    const superseded = completePluginStateSnapshotRestore(deps.db, {
      id: snapshot.id,
      pluginId: snapshot.pluginId,
      updatedAt: now(),
    });
    if (superseded === undefined) {
      throw new Error(`plugin rollback snapshot disappeared: ${snapshot.id}`);
    }
    for (const discarded of superseded) await removeSnapshotFiles(discarded);
    pruneRollbackPoints();
    return problem;
  }

  function setUnusable(snapshot: PluginStateSnapshotRow, reason: string) {
    const warning = `bb could not undo the ${snapshot.operation}${snapshotTarget(snapshot)}: its saved state is unusable (${reason}); the plugin keeps its current release and data`;
    if (
      !setPluginStateSnapshotFailed(deps.db, snapshot.id, {
        detail: reason,
        updatedAt: now(),
      })
    ) {
      throw new Error(
        `plugin rollback snapshot ${snapshot.id} could not be marked failed`,
      );
    }
    if (snapshot.rollbackCandidateVersion !== null) {
      setInstalledPluginLastFailure(deps.db, snapshot.pluginId, {
        version: snapshot.rollbackCandidateVersion,
        detail:
          snapshot.rollbackDetail === null
            ? warning
            : `${snapshot.rollbackDetail}; ${warning}`,
        at: now(),
      });
    }
    logger.warn(`plugin ${snapshot.pluginId}: ${warning}`);
    return warning;
  }

  async function holdRestore(
    snapshot: PluginStateSnapshotRow,
    detail: string,
    cause?: unknown,
  ): Promise<never> {
    setPluginStateSnapshotRestoreFailure(deps.db, snapshot.id, {
      detail,
      updatedAt: now(),
    });
    const row = getInstalledPlugin(deps.db, snapshot.pluginId);
    if (row) await loadOne(row);
    const hold =
      pluginRestoreHold(deps.db, snapshot.pluginId) ??
      `held until bb finishes undoing its ${snapshot.operation}: ${detail}`;
    throw new Error(`plugin "${snapshot.pluginId}" is ${hold}`, { cause });
  }

  async function checkRestorable(snapshot: PluginStateSnapshotRow) {
    const rollback = rollbackMetadata(snapshot);
    if (rollback === null) {
      return {
        kind: "unusable" as const,
        reason: "it is missing rollback metadata",
      };
    }
    const checked = await checkPluginStateSnapshot({
      db: deps.db,
      snapshot,
      registrationProblem,
    });
    return checked.kind === "usable" ? { ...checked, rollback } : checked;
  }

  async function recoverPluginWithinLifecycle(
    pluginId: string,
  ): Promise<PluginRecovery> {
    const warnings: string[] = [];
    for (const snapshot of listIncompletePluginRollbackSnapshots(
      deps.db,
      pluginId,
    )) {
      const checked = await checkRestorable(snapshot);
      if (checked.kind !== "usable") {
        if (
          checked.kind === "unusable" &&
          snapshot.status === "rollback-pending"
        ) {
          warnings.push(setUnusable(snapshot, checked.reason));
          continue;
        }
        return holdRestore(snapshot, checked.reason);
      }
      let problem: string | null;
      try {
        problem = await restoreSnapshotWithinLifecycle(
          snapshot,
          checked.rollback,
          checked.registration,
        );
      } catch (error) {
        return holdRestore(snapshot, errorMessage(error), error);
      }
      return { restored: snapshot, problem, warnings };
    }
    const row = getInstalledPlugin(deps.db, pluginId);
    const problem = row ? await loadOne(row) : null;
    return { restored: null, problem, warnings };
  }

  function retryPluginRestore(pluginId: string): Promise<PluginRecovery> {
    const [oldest] = listIncompletePluginRollbackSnapshots(deps.db, pluginId);
    const recover = () =>
      withLifecycleLock(pluginId, () => recoverPluginWithinLifecycle(pluginId));
    if (oldest === undefined) return recover();
    const artifact = getPluginArtifact(deps.db, oldest.toArtifactId);
    return withArtifactLock(
      (artifact === undefined ? null : pluginArtifactStorageRoot(artifact)) ??
        oldest.snapshotPath,
      recover,
    );
  }

  function startFailure(pluginId: string): string | null {
    const runtime = statuses.get(pluginId);
    if (
      runtime === undefined ||
      runtime.status === "running" ||
      runtime.status === "disabled" ||
      runtime.status === "needs-configuration"
    ) {
      return null;
    }
    return runtime.detail ?? runtime.status;
  }

  async function recoverIncompletePluginRollbacks(): Promise<void> {
    const pluginIds = new Set(
      listIncompletePluginRollbackSnapshots(deps.db).map(
        ({ pluginId }) => pluginId,
      ),
    );
    for (const pluginId of pluginIds) {
      if (getInstalledPlugin(deps.db, pluginId) === undefined) {
        logger.warn(
          `plugin ${pluginId} was removed before bb finished restoring it, so bb deletes its snapshots instead of restoring it`,
        );
        await removePluginStateSnapshots({
          db: deps.db,
          pluginId,
          warn: (message) => logger.warn(message),
        });
        continue;
      }
      let recovery: PluginRecovery;
      try {
        recovery = await retryPluginRestore(pluginId);
      } catch (error) {
        logger.error(
          { err: error, pluginId },
          "plugin restore did not finish; bb holds the plugin until a reload or the next start retries it",
        );
        continue;
      }
      const failure = startFailure(pluginId);
      if (recovery.restored !== null && failure !== null) {
        logger.warn(
          `plugin ${pluginId} was restored after an interrupted ${recovery.restored.operation}, but it failed to start: ${failure}`,
        );
      }
    }
  }

  async function removeSnapshotFiles(
    snapshot: PluginStateSnapshotRow,
  ): Promise<void> {
    await rm(snapshot.snapshotPath, { recursive: true, force: true }).catch(
      (error: unknown) => {
        logger.warn(
          `plugin snapshot files at ${snapshot.snapshotPath} could not be removed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }

  async function activateManagedUpdate(args: {
    row: InstalledPluginRow;
    rootDir: string;
    manifest: PluginManifest;
    source: string;
    sourceIntent: PluginSourceIntent;
    exactResolution: PluginExactResolution;
    artifactId: string;
    beforePersist?: () => Promise<void>;
    rollback?: PluginRollbackActivation;
  }): Promise<void> {
    const provenance = provenanceForRow(args.row);
    const candidateVersion =
      args.exactResolution.kind === "npm"
        ? args.exactResolution.version
        : args.exactResolution.kind === "git"
          ? args.exactResolution.commit
          : args.manifest.version;
    const rollbackMetadataFor = (detail: string) => ({
      candidateVersion,
      sourceFingerprint: sourceFingerprint(args.row),
      bbVersion: deps.appVersion,
      sdkVersion: PLUGIN_SDK_VERSION,
      detail,
      updatedAt: now(),
    });
    const markRollbackPending = (snapshotId: string, detail: string) => {
      if (
        !setPluginStateSnapshotRollbackPending(
          deps.db,
          snapshotId,
          rollbackMetadataFor(detail),
        )
      ) {
        throw new Error(
          `plugin rollback snapshot ${snapshotId} could not be marked pending`,
        );
      }
    };
    await withLifecycleLock(args.row.id, async () => {
      const beforeDispose = getInstalledPlugin(deps.db, args.row.id);
      if (
        beforeDispose === undefined ||
        !registrationMatchesForActivation(beforeDispose, args.row)
      ) {
        throw new Error(
          `plugin "${args.row.id}" registration changed during update`,
        );
      }
      await disposeOne(args.row.id);
      const snapshotNow = now();
      let snapshot: Awaited<ReturnType<typeof createPluginStateSnapshotOnDisk>>;
      try {
        snapshot = await createPluginStateSnapshotOnDisk({
          db: deps.db,
          dataDir: deps.dataDir,
          pluginId: args.row.id,
          fromArtifactId: args.row.activeArtifactId,
          toArtifactId: args.artifactId,
          now: snapshotNow,
          retainedUntil: snapshotNow + artifactRetentionMs,
          previousRegistration: args.row,
          operation: args.rollback === undefined ? "update" : "rollback",
        });
      } catch (error) {
        const previous = getInstalledPlugin(deps.db, args.row.id);
        if (previous) await loadOne(previous);
        throw error;
      }
      if (args.rollback === undefined) {
        await rememberRollbackPoint(snapshot, args.row);
      }
      let pointerWritten = false;
      let operationWritten = false;
      try {
        reportPluginUpdatePhase("activating");
        await args.beforePersist?.();
        const beforeWrite = getInstalledPlugin(deps.db, args.row.id);
        if (
          beforeWrite === undefined ||
          !registrationMatchesForActivation(beforeWrite, args.row)
        ) {
          throw new Error(
            `plugin "${args.row.id}" registration changed during activation`,
          );
        }
        if (
          args.rollback !== undefined &&
          !setPluginStateSnapshotRollbackWriting(
            deps.db,
            snapshot.id,
            rollbackMetadataFor(
              `rolling back to ${args.manifest.version} was interrupted before it finished`,
            ),
          )
        ) {
          throw new Error(
            `plugin rollback snapshot ${snapshot.id} could not be marked restoring`,
          );
        }
        upsertInstalledPlugin(deps.db, {
          id: args.row.id,
          source: args.source,
          provenance,
          sourceIntent: args.sourceIntent,
          exactResolution: args.exactResolution,
          updateState: emptyPluginUpdateState(),
          activeArtifactId: args.artifactId,
          rootDir: args.rootDir,
          version: args.manifest.version,
          enabled: args.row.enabled,
          enabledFollowsDefault: args.row.enabledFollowsDefault,
        });
        pointerWritten = true;
        if (args.rollback !== undefined) {
          await applyPluginStateSnapshot({
            db: deps.db,
            dataDir: deps.dataDir,
            snapshotId: args.rollback.snapshot.id,
          });
          if (
            !setPluginStateSnapshotRollbackApplied(deps.db, snapshot.id, now())
          ) {
            throw new Error(
              `plugin rollback snapshot ${snapshot.id} could not be marked pending`,
            );
          }
        }
        operationWritten = true;
        const current = getInstalledPlugin(deps.db, args.row.id);
        stabilizingPluginIds.add(args.row.id);
        if (current) await loadIgnoringRestoreHold(current);
        const immediate = statuses.get(args.row.id);
        if (immediate?.status === "error") {
          throw new Error(immediate.detail ?? "plugin failed to load");
        }
        if (stabilizationWindowMs > 0) {
          reportPluginUpdatePhase("checking");
          const failure = await new Promise<string | null>((resolveFailure) => {
            let cancelWindow = () => {};
            const listener = (
              status: PluginRuntimeStatus,
              detail: string | null,
            ) => {
              if (status !== "error") return;
              cancelWindow();
              const currentListeners = statusListeners.get(args.row.id);
              currentListeners?.delete(listener);
              if (currentListeners?.size === 0) {
                statusListeners.delete(args.row.id);
              }
              resolveFailure(detail ?? "plugin entered error status");
            };
            let listeners = statusListeners.get(args.row.id);
            if (listeners === undefined) {
              listeners = new Set();
              statusListeners.set(args.row.id, listeners);
            }
            listeners.add(listener);
            cancelWindow = scheduleStabilizationWindow(
              stabilizationWindowMs,
              () => {
                listeners.delete(listener);
                if (listeners.size === 0) statusListeners.delete(args.row.id);
                resolveFailure(null);
              },
            );
            const currentStatus = statuses.get(args.row.id);
            if (currentStatus?.status === "error") {
              listener(currentStatus.status, currentStatus.detail);
            }
          });
          if (failure !== null) throw new Error(failure);
        }
        if (args.rollback !== undefined) {
          setPluginStateSnapshotStatus(
            deps.db,
            snapshot.id,
            "discarded",
            now(),
          );
          setPluginStateSnapshotStatus(
            deps.db,
            args.rollback.snapshot.id,
            "restored",
            now(),
          );
          for (const finished of [snapshot, args.rollback.snapshot]) {
            await removeSnapshotFiles(finished);
          }
        }
      } catch (error) {
        if (!pointerWritten) {
          if (args.rollback !== undefined) {
            setPluginStateSnapshotStatus(
              deps.db,
              snapshot.id,
              "discarded",
              now(),
            );
            await removeSnapshotFiles(snapshot);
          }
          const previous = getInstalledPlugin(deps.db, args.row.id);
          if (previous) await loadOne(previous);
          throw error;
        }
        const detail = error instanceof Error ? error.message : String(error);
        if (operationWritten) markRollbackPending(snapshot.id, detail);
        reportPluginUpdatePhase("rolling-back");
        const failed =
          args.rollback === undefined
            ? `activation of ${args.manifest.version} failed`
            : `rolling back to ${args.manifest.version} failed`;
        let recovery: PluginRecovery;
        try {
          recovery = await recoverPluginWithinLifecycle(args.row.id);
        } catch (recoveryError) {
          throw new Error(
            `${failed}: ${detail}; ${errorMessage(recoveryError)}`,
            { cause: recoveryError },
          );
        }
        if (recovery.restored === null) {
          throw new Error(
            `${failed}: ${detail}; ${recovery.warnings.join("; ")}`,
          );
        }
        if (args.rollback !== undefined) await removeSnapshotFiles(snapshot);
        const restoredFailure = startFailure(args.row.id);
        const failures =
          restoredFailure === null
            ? detail
            : `${detail}; the restored ${args.row.version} failed to start as well: ${restoredFailure}`;
        throw new PluginActivationRolledBackError(
          args.rollback === undefined
            ? `activation of ${args.manifest.version} failed and was rolled back: ${failures}; run apply update again to retry explicitly`
            : `rolling back to ${args.manifest.version} failed, so bb restored ${args.row.version} and the data it had before the rollback: ${failures}`,
        );
      } finally {
        stabilizingPluginIds.delete(args.row.id);
        pruneRollbackPoints();
      }
    });
    await syncCliSkill();
    notifyPluginsChanged();
  }

  async function runArtifactGc(): Promise<void> {
    await garbageCollectPluginArtifacts({
      db: deps.db,
      dataDir: deps.dataDir,
      now: now(),
      retentionMs: artifactRetentionMs,
      warn: (message) => logger.warn(message),
    });
    pruneRollbackPoints();
  }

  return {
    activateManagedUpdate,
    recoverIncompletePluginRollbacks,
    retryPluginRestore,
    runArtifactGc,
  };
}
