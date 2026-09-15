import { randomBytes, randomUUID } from "node:crypto";
import { rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ServerBindHost } from "@bb/config/server";
import { listNonDestroyedHostsByIds } from "@bb/db";
import { SERVER_MOVE_STEP_IDS, type ServerMoveStepId } from "@bb/domain";
import type {
  ServerMovedErrorDetails,
  ServerMoveProgressMessage,
} from "@bb/host-daemon-contract";
import type {
  ServerMoveCheckItem,
  ServerMoveCheckRequest,
  ServerMoveCheckResponse,
  ServerMoveStartRequest,
  ServerMoveStatus,
  ServerMoveStep,
  ServerMoveStepStatus,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import {
  runServerMoveCheck,
  type ServerMoveCheckEnvironment,
} from "./checks.js";
import type { ServerArchiveExport } from "./export.js";
import type {
  FullBbAppArtifact,
  FullBbAppArtifactService,
} from "./full-artifact.js";
import {
  setServerMoveFrozen,
  setServerMoveSnapshotFence,
} from "./freeze-state.js";
import type { ServerMoveModeResolution } from "./mode.js";
import {
  listServerMovedTargets,
  lockOldServerDataDir,
  restoreOldServerDaemonConfig,
  unlockOldServerDataDir,
  writeOldServerDaemonConfig,
  type OldServerDaemonConfigBackup,
} from "./switch.js";

export const SERVER_MOVE_WORK_DIR_NAME = "server-move";

export interface ServerMoveGrant {
  headers: Record<string, string>;
  serverUrl: string;
}

export interface ServerMovePluginControl {
  resumeSuspended(): Promise<void>;
  setSchedulesPaused(paused: boolean): void;
  stop(): Promise<void>;
  suspendAllButConnect(): Promise<void>;
}

export interface ServerMoveTimings {
  abortTimeoutMs: number;
  activateAttemptTimeoutMs: number;
  activateRetryDelayMs: number;
  activateRetryWindowMs: number;
  inspectTimeoutMs: number;
  prepareTimeoutMs: number;
  probeTimeoutMs: number;
  retireDelayMs: number;
  stopWorkTimeoutMs: number;
}

export interface ServerMoveExportArgs {
  sourceServerHostId: string;
  workDir: string;
}

export interface ServerMoveStopWorkArgs {
  targetHostName: string;
  timeoutMs: number;
}

export interface ServerMoveEnvironment {
  allowLoopbackServerUrl: boolean;
  bindHost: ServerBindHost | null;
  deps: AppDeps;
  exportArchive(args: ServerMoveExportArgs): Promise<ServerArchiveExport>;
  fullArtifact: FullBbAppArtifactService;
  now(): number;
  plugins: ServerMovePluginControl;
  resolveMode(): Promise<ServerMoveModeResolution>;
  resolveServerHostGrant(
    hostId: string,
    signal: AbortSignal,
  ): Promise<ServerMoveGrant>;
  resumeDeferredWork(): void;
  retireProcess(): void;
  serverTimeZone: string | null;
  stopRunningWork(args: ServerMoveStopWorkArgs): Promise<void>;
  targetServerPort(): number;
  timings: ServerMoveTimings;
}

export type ServerMoveDownloadKind = "archive" | "bb-app";

export interface ServerMoveDownload {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export type ServerMoveDownloadLookup =
  | { outcome: "found"; download: ServerMoveDownload }
  | { outcome: "forbidden" }
  | { outcome: "not_found" };

export interface ResolveServerMoveDownloadArgs {
  hostId: string;
  kind: ServerMoveDownloadKind;
  moveId: string;
}

export interface ServerMoveCoordinator {
  cancel(): ServerMoveStatus;
  check(request: ServerMoveCheckRequest): Promise<ServerMoveCheckResponse>;
  getStatus(): ServerMoveStatus | null;
  handleProgress(hostId: string, message: ServerMoveProgressMessage): void;
  isFrozen(): boolean;
  movedTo(): ServerMovedErrorDetails | null;
  resolveDownload(
    args: ResolveServerMoveDownloadArgs,
  ): ServerMoveDownloadLookup;
  start(request: ServerMoveStartRequest): Promise<ServerMoveStatus>;
}

interface MoveHost {
  id: string;
  name: string;
}

interface MoveRun {
  abort: AbortController;
  activationToken: string;
  archive: ServerArchiveExport | null;
  archiveExistingTargetServerData: boolean;
  bbApp: FullBbAppArtifact | null;
  connectHandle: string | null;
  finished: boolean;
  frozen: boolean;
  grant: ServerMoveGrant | null;
  movedAt: number | null;
  pluginsSuspended: boolean;
  sourceServerHost: MoveHost;
  status: ServerMoveStatus;
  workDir: string;
}

type ActivationOutcome =
  | { outcome: "activated" }
  | { outcome: "refused"; message: string }
  | { outcome: "unconfirmed"; message: string };

const PREPARE_PROGRESS_STEPS: ReadonlySet<ServerMoveStepId> = new Set([
  "update-target",
  "transfer",
  "start-target",
]);
const ALREADY_ACTIVATED_ERROR_CODE = "server_move_already_activated";
const ARCHIVE_ERROR_CODE_PREFIX = "server_move_archive_";
const DAEMON_ERROR_SUMMARIES: Record<string, string> = {
  server_move_activation_rejected: "The machine refused to take over",
  server_move_busy: "The machine is busy with another server move",
  server_move_cancelled: "The machine cancelled the move",
  server_move_digest_mismatch: "The export was damaged in transit",
  server_move_download_failed: "The machine couldn't download the export",
  server_move_install_failed: "Installing bb on the machine failed",
  server_move_rejected: "The machine rejected the move",
  server_move_server_entry_unavailable: "The machine can't run the bb server",
  server_move_start_failed: "The new server didn't start",
};

class ServerMoveCancelledError extends Error {
  constructor() {
    super("The move was cancelled");
    this.name = "ServerMoveCancelledError";
  }
}

export function serverMoveArchiveDownloadPath(moveId: string): string {
  return `/internal/server-move/${encodeURIComponent(moveId)}/archive`;
}

export function serverMoveBbAppDownloadPath(moveId: string): string {
  return `/internal/server-move/${encodeURIComponent(moveId)}/bb-app.tgz`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeServerMoveError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return errorMessage(error);
  }
  const code = error.body.code;
  const summary =
    DAEMON_ERROR_SUMMARIES[code] ??
    (code.startsWith(ARCHIVE_ERROR_CODE_PREFIX)
      ? "The machine couldn't unpack the export"
      : null);
  return summary === null ? error.message : `${summary}: ${error.message}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function requireValue<T>(value: T | null, description: string): T {
  if (value === null) {
    throw new Error(`Server move is missing ${description}`);
  }
  return value;
}

function createSteps(): ServerMoveStep[] {
  return SERVER_MOVE_STEP_IDS.map((id) => ({
    id,
    status: "pending",
    message: null,
  }));
}

function isAlreadyActivatedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.body.code === ALREADY_ACTIVATED_ERROR_CODE
  );
}

function isDaemonRefusal(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 502 &&
    error.body.code !== "host_unavailable"
  );
}

function inProgressError(): ApiError {
  return new ApiError(
    409,
    "server_move_in_progress",
    "A server move is already in progress",
  );
}

export function createServerMoveCoordinator(
  environment: ServerMoveEnvironment,
): ServerMoveCoordinator {
  const { deps, timings } = environment;
  const checkEnvironment: ServerMoveCheckEnvironment = {
    allowLoopbackServerUrl: environment.allowLoopbackServerUrl,
    deps,
    fullArtifact: environment.fullArtifact,
    inspectTimeoutMs: timings.inspectTimeoutMs,
    resolveMode: () => environment.resolveMode(),
    serverTimeZone: environment.serverTimeZone,
    targetServerPort: () => environment.targetServerPort(),
  };
  let current: MoveRun | null = null;
  let starting = false;

  function notify(): void {
    deps.hub.notifySystem(["server-move-changed"]);
  }

  function isBlocking(move: MoveRun | null): boolean {
    return (
      move !== null &&
      (move.status.state === "preparing" ||
        move.status.state === "switching" ||
        move.status.state === "completed")
    );
  }

  function findStep(move: MoveRun, id: ServerMoveStepId): ServerMoveStep {
    const step = move.status.steps.find((candidate) => candidate.id === id);
    if (step === undefined) {
      throw new Error(`Unknown server move step ${id}`);
    }
    return step;
  }

  function setStep(
    move: MoveRun,
    id: ServerMoveStepId,
    status: ServerMoveStepStatus,
    message: string | null,
  ): void {
    const step = findStep(move, id);
    step.status = status;
    step.message = message;
    notify();
  }

  function assertNotCancelled(move: MoveRun): void {
    if (move.abort.signal.aborted) {
      throw new ServerMoveCancelledError();
    }
  }

  function untilCancelled<T>(move: MoveRun, work: Promise<T>): Promise<T> {
    const signal = move.abort.signal;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new ServerMoveCancelledError());
      if (signal.aborted) {
        work.catch(() => {});
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      work.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  async function runStopWork(move: MoveRun): Promise<void> {
    move.frozen = true;
    setServerMoveFrozen(deps.db, true);
    environment.plugins.setSchedulesPaused(true);
    setStep(move, "stop-work", "running", "Stopping running turns");
    await untilCancelled(
      move,
      environment.stopRunningWork({
        targetHostName: move.status.targetHostName,
        timeoutMs: timings.stopWorkTimeoutMs,
      }),
    );
    move.grant =
      move.status.mode === "connect"
        ? await untilCancelled(
            move,
            environment.resolveServerHostGrant(
              move.sourceServerHost.id,
              move.abort.signal,
            ),
          )
        : { serverUrl: move.status.serverUrl, headers: {} };
    setStep(
      move,
      "stop-work",
      "done",
      "Running work stopped and changes paused",
    );
  }

  async function runUpdateTarget(move: MoveRun): Promise<void> {
    const targetName = move.status.targetHostName;
    setStep(move, "update-target", "running", `Checking ${targetName}`);
    const inspect = await untilCancelled(
      move,
      callHostOnlineRpc(deps, {
        hostId: move.status.targetHostId,
        timeoutMs: timings.inspectTimeoutMs,
        command: {
          type: "server_move.inspect",
          paths: [],
          port: environment.targetServerPort(),
        },
      }),
    );
    if (inspect.dataDirHasServerData) {
      throw new Error(
        `${targetName} already has bb server data in ${inspect.dataDir}`,
      );
    }
    if (!inspect.portAvailable) {
      throw new Error(
        `Port ${environment.targetServerPort()} is in use on ${targetName}`,
      );
    }
    if (
      inspect.existingServerData !== null &&
      !move.archiveExistingTargetServerData
    ) {
      throw new Error(
        `${targetName} has its own bb data at ${inspect.existingServerData.path}. Confirm archiving it, then start the move again.`,
      );
    }
    const appVersion = deps.config.appVersion;
    if (inspect.serverEntryAvailable && inspect.bbAppVersion === appVersion) {
      setStep(
        move,
        "update-target",
        "skipped",
        `${targetName} already runs bb ${appVersion}`,
      );
      return;
    }
    setStep(
      move,
      "update-target",
      "running",
      `Packing bb ${appVersion} for ${targetName}`,
    );
    const bbApp = await untilCancelled(move, environment.fullArtifact.build());
    move.bbApp = bbApp;
    setStep(
      move,
      "update-target",
      "done",
      `bb ${bbApp.version} will be installed on ${targetName}`,
    );
  }

  async function runExport(move: MoveRun): Promise<void> {
    setStep(move, "export", "running", "Pausing plugins");
    move.pluginsSuspended = true;
    await environment.plugins.suspendAllButConnect();
    assertNotCancelled(move);
    setStep(move, "export", "running", "Exporting server data");
    setServerMoveSnapshotFence(deps.db, true);
    const archive = await environment.exportArchive({
      sourceServerHostId: move.sourceServerHost.id,
      workDir: move.workDir,
    });
    move.archive = archive;
    assertNotCancelled(move);
    setStep(
      move,
      "export",
      "done",
      `Exported ${formatBytes(archive.sizeBytes)}`,
    );
  }

  async function runPrepare(move: MoveRun): Promise<void> {
    const archive = requireValue(move.archive, "its export");
    const targetName = move.status.targetHostName;
    setStep(
      move,
      "transfer",
      "running",
      `Sending ${formatBytes(archive.sizeBytes)} to ${targetName}`,
    );
    const result = await untilCancelled(
      move,
      callHostOnlineRpc(deps, {
        hostId: move.status.targetHostId,
        timeoutMs: timings.prepareTimeoutMs,
        command: {
          type: "server_move.prepare",
          moveId: move.status.moveId,
          activationToken: move.activationToken,
          archive: {
            downloadPath: serverMoveArchiveDownloadPath(move.status.moveId),
            sha256: archive.sha256,
            sizeBytes: archive.sizeBytes,
          },
          bbApp:
            move.bbApp === null
              ? null
              : {
                  downloadPath: serverMoveBbAppDownloadPath(move.status.moveId),
                  sha256: move.bbApp.sha256,
                  version: move.bbApp.version,
                },
          serverPort: environment.targetServerPort(),
          bindHost: environment.bindHost === "0.0.0.0" ? "0.0.0.0" : null,
          sourceDataDir: deps.config.dataDir,
          sourceServerHostId: move.sourceServerHost.id,
          serverUrl: move.status.serverUrl,
          archiveExistingServerData: move.archiveExistingTargetServerData,
        },
      }),
    );
    if (findStep(move, "update-target").status === "running") {
      findStep(move, "update-target").status = "done";
    }
    if (findStep(move, "transfer").status !== "done") {
      setStep(move, "transfer", "done", `Sent to ${targetName}`);
    }
    setStep(
      move,
      "start-target",
      "done",
      `The new server started on ${targetName}`,
    );
    deps.logger.info(
      {
        localServerUrl: result.localServerUrl,
        moveId: move.status.moveId,
        pid: result.pid,
        targetHostId: move.status.targetHostId,
      },
      "Server move target started its pending server",
    );
  }

  async function runVerifyAddress(move: MoveRun): Promise<void> {
    const serverUrl = move.status.serverUrl;
    if (move.status.mode === "connect") {
      setStep(
        move,
        "verify-address",
        "skipped",
        `Machines keep using ${serverUrl}`,
      );
      return;
    }
    setStep(
      move,
      "verify-address",
      "running",
      `Checking that machines can reach ${serverUrl}`,
    );
    const hosts = listNonDestroyedHostsByIds(
      deps.db,
      deps.hub.listConnectedHostIds(),
    ).filter(
      (host) =>
        host.type === "persistent" && host.id !== move.status.targetHostId,
    );
    const failures = await untilCancelled(
      move,
      Promise.all(
        hosts.map(async (host) => {
          try {
            const probe = await callHostOnlineRpc(deps, {
              hostId: host.id,
              timeoutMs: timings.probeTimeoutMs,
              command: {
                type: "server_move.probe",
                url: serverUrl,
                moveId: move.status.moveId,
              },
            });
            return probe.reachable
              ? null
              : `${host.name}: ${probe.message ?? "unreachable"}`;
          } catch (error) {
            return `${host.name}: ${errorMessage(error)}`;
          }
        }),
      ),
    );
    const problems = failures.filter(
      (failure): failure is string => failure !== null,
    );
    if (problems.length > 0) {
      throw new Error(
        `Not every machine can reach ${serverUrl}. ${problems.join("; ")}`,
      );
    }
    setStep(
      move,
      "verify-address",
      "done",
      `${hosts.length === 1 ? "1 machine" : `${hosts.length} machines`} reached ${serverUrl}`,
    );
  }

  async function rollbackSwitchFiles(
    backup: OldServerDaemonConfigBackup | null,
  ): Promise<void> {
    await unlockOldServerDataDir(deps.config.dataDir).catch(
      (error: unknown) => {
        deps.logger.error(
          { err: error },
          "Server move could not remove server-moved.json after a failed switch",
        );
      },
    );
    if (backup === null) {
      return;
    }
    await restoreOldServerDaemonConfig(backup).catch((error: unknown) => {
      deps.logger.error(
        { err: error },
        "Server move could not restore config.json after a failed switch",
      );
    });
  }

  async function requestActivation(
    move: MoveRun,
    completedAt: number,
    timeoutMs: number,
  ): Promise<void> {
    await callHostOnlineRpc(deps, {
      hostId: move.status.targetHostId,
      timeoutMs,
      command: {
        type: "server_move.activate",
        moveId: move.status.moveId,
        activationToken: move.activationToken,
        lastMove: {
          moveId: move.status.moveId,
          fromHostId: move.sourceServerHost.id,
          fromHostName: move.sourceServerHost.name,
          toHostId: move.status.targetHostId,
          toHostName: move.status.targetHostName,
          completedAt,
          oldCopyDeletedAt: null,
        },
      },
    });
  }

  async function activateTarget(
    move: MoveRun,
    completedAt: number,
  ): Promise<ActivationOutcome> {
    const targetHostId = move.status.targetHostId;
    const targetName = move.status.targetHostName;
    const deadline = Date.now() + timings.activateRetryWindowMs;
    let attempted = false;
    let lastProblem = `${targetName} disconnected before confirming`;
    while (true) {
      const remaining = deadline - Date.now();
      if (!deps.hub.hasDaemonForHost(targetHostId)) {
        const reconnected =
          remaining > 0 &&
          (await deps.hub.waitForDaemonForHost(targetHostId, remaining));
        if (!reconnected) {
          return attempted
            ? { outcome: "unconfirmed", message: lastProblem }
            : {
                outcome: "refused",
                message: `${targetName} disconnected before it could take over`,
              };
        }
      }
      attempted = true;
      try {
        await requestActivation(
          move,
          completedAt,
          Math.max(
            1,
            Math.min(timings.activateAttemptTimeoutMs, deadline - Date.now()),
          ),
        );
        return { outcome: "activated" };
      } catch (error) {
        if (isAlreadyActivatedError(error)) {
          return { outcome: "activated" };
        }
        if (isDaemonRefusal(error)) {
          return {
            outcome: "refused",
            message: `${targetName} couldn't take over: ${describeServerMoveError(error)}`,
          };
        }
        lastProblem = errorMessage(error);
        deps.logger.warn(
          { err: error, moveId: move.status.moveId, targetHostId },
          "Server move activation was not confirmed; retrying",
        );
      }
      const wait = deadline - Date.now();
      if (wait <= 0) {
        return { outcome: "unconfirmed", message: lastProblem };
      }
      await sleep(Math.min(timings.activateRetryDelayMs, wait));
    }
  }

  function sendServerMoved(move: MoveRun, grant: ServerMoveGrant): void {
    const connectedHosts = listNonDestroyedHostsByIds(
      deps.db,
      deps.hub.listConnectedHostIds(),
    );
    const targets = listServerMovedTargets({
      connectedHosts,
      mode: move.status.mode,
      sourceServerHostId: move.sourceServerHost.id,
      targetHostId: move.status.targetHostId,
    });
    for (const hostId of targets) {
      const ownHost = hostId === move.sourceServerHost.id;
      try {
        deps.hub.sendDaemonMessage(hostId, {
          type: "server.moved",
          serverUrl: ownHost ? grant.serverUrl : move.status.serverUrl,
          headers: ownHost ? grant.headers : {},
        });
      } catch (error) {
        deps.logger.warn(
          { err: error, hostId, moveId: move.status.moveId },
          "Server move could not tell a machine about the new address",
        );
      }
    }
  }

  async function runSwitch(move: MoveRun): Promise<void> {
    assertNotCancelled(move);
    const grant = requireValue(move.grant, "the server machine's address");
    const archive = requireValue(move.archive, "its export");
    const targetName = move.status.targetHostName;
    move.status.cancellable = false;
    move.status.state = "switching";
    setStep(move, "switch", "running", `Switching to ${targetName}`);
    const movedAt = environment.now();
    let configBackup: OldServerDaemonConfigBackup | null = null;
    try {
      await lockOldServerDataDir(deps.config.dataDir, {
        version: 1,
        moveId: move.status.moveId,
        movedAt,
        fromHostId: move.sourceServerHost.id,
        toHostId: move.status.targetHostId,
        toHostName: targetName,
        serverUrl: move.status.serverUrl,
        mode: move.status.mode,
        connectHandle: move.connectHandle,
        oldCopyEntries: archive.oldCopyEntries,
      });
      configBackup = await writeOldServerDaemonConfig({
        dataDir: deps.config.dataDir,
        headers: grant.headers,
        serverUrl: grant.serverUrl,
      });
    } catch (error) {
      await rollbackSwitchFiles(configBackup);
      throw error;
    }
    const activation = await activateTarget(move, environment.now());
    if (activation.outcome === "refused") {
      await rollbackSwitchFiles(configBackup);
      throw new Error(activation.message);
    }
    move.finished = true;
    move.movedAt = movedAt;
    if (activation.outcome === "unconfirmed") {
      deps.logger.warn(
        {
          err: activation.message,
          moveId: move.status.moveId,
          targetHostId: move.status.targetHostId,
        },
        "Server move target did not confirm activation; continuing the switch",
      );
    }
    await environment.plugins.stop().catch((error: unknown) => {
      deps.logger.warn({ err: error }, "Server move plugin shutdown failed");
    });
    sendServerMoved(move, grant);
    move.status.state = "completed";
    move.status.finishedAt = environment.now();
    setStep(move, "switch", "done", `The server now runs on ${targetName}`);
    setTimeout(() => {
      environment.retireProcess();
    }, timings.retireDelayMs);
  }

  async function sendAbort(move: MoveRun): Promise<void> {
    try {
      await callHostOnlineRpc(deps, {
        hostId: move.status.targetHostId,
        timeoutMs: timings.abortTimeoutMs,
        command: { type: "server_move.abort", moveId: move.status.moveId },
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          moveId: move.status.moveId,
          targetHostId: move.status.targetHostId,
        },
        "Server move abort could not reach the target machine",
      );
    }
  }

  async function failMove(move: MoveRun, error: unknown): Promise<void> {
    if (move.finished) {
      return;
    }
    move.finished = true;
    const cancelled = error instanceof ServerMoveCancelledError;
    const message = describeServerMoveError(error);
    const runningStep = move.status.steps.find(
      (step) => step.status === "running",
    );
    const failedStepId =
      runningStep?.id ??
      move.status.steps.find((step) => step.status === "pending")?.id ??
      "switch";
    if (runningStep !== undefined) {
      runningStep.status = cancelled ? "skipped" : "failed";
      runningStep.message = message;
    }
    move.status.state = cancelled ? "cancelled" : "failed";
    move.status.error = { step: failedStepId, message };
    move.status.cancellable = false;
    move.status.finishedAt = environment.now();
    move.frozen = false;
    setServerMoveSnapshotFence(deps.db, false);
    notify();
    if (!cancelled) {
      deps.logger.warn(
        { err: error, moveId: move.status.moveId, step: failedStepId },
        "Server move failed",
      );
    }
    await Promise.all([resumeFrozenWork(move), sendAbort(move)]);
  }

  async function resumeFrozenWork(move: MoveRun): Promise<void> {
    if (move.pluginsSuspended) {
      move.pluginsSuspended = false;
      await environment.plugins.resumeSuspended().catch((error: unknown) => {
        deps.logger.error(
          { err: error, moveId: move.status.moveId },
          "Server move could not restart paused plugins",
        );
      });
    }
    if (current !== move) {
      return;
    }
    setServerMoveFrozen(deps.db, false);
    environment.plugins.setSchedulesPaused(false);
    environment.resumeDeferredWork();
  }

  async function run(move: MoveRun): Promise<void> {
    try {
      await runStopWork(move);
      assertNotCancelled(move);
      await runUpdateTarget(move);
      assertNotCancelled(move);
      await runExport(move);
      assertNotCancelled(move);
      await runPrepare(move);
      assertNotCancelled(move);
      await runVerifyAddress(move);
      await runSwitch(move);
    } catch (error) {
      await failMove(move, error);
    } finally {
      await rm(move.workDir, { force: true, recursive: true }).catch(
        (error: unknown) => {
          deps.logger.warn(
            { err: error, workDir: move.workDir },
            "Server move could not remove its work directory",
          );
        },
      );
      await rmdir(dirname(move.workDir)).catch(() => undefined);
    }
  }

  return {
    cancel() {
      const move = current;
      if (
        move === null ||
        move.status.state !== "preparing" ||
        !move.status.cancellable
      ) {
        throw new ApiError(
          409,
          "server_move_not_cancellable",
          move !== null &&
            (move.status.state === "switching" ||
              move.status.state === "completed")
            ? "The move can't be cancelled after the switch starts"
            : "No server move is in progress",
        );
      }
      move.abort.abort();
      void failMove(move, new ServerMoveCancelledError());
      return structuredClone(move.status);
    },

    async check(request) {
      const result = await runServerMoveCheck(checkEnvironment, {
        moveInProgress: starting || isBlocking(current),
        request,
      });
      return result.response;
    },

    getStatus() {
      return current === null ? null : structuredClone(current.status);
    },

    handleProgress(hostId, message) {
      const move = current;
      if (
        move === null ||
        move.status.moveId !== message.moveId ||
        move.status.targetHostId !== hostId ||
        move.status.state !== "preparing"
      ) {
        return;
      }
      if (!PREPARE_PROGRESS_STEPS.has(message.step)) {
        return;
      }
      for (const step of move.status.steps) {
        if (
          step.id !== message.step &&
          PREPARE_PROGRESS_STEPS.has(step.id) &&
          step.status === "running"
        ) {
          step.status = "done";
        }
      }
      setStep(move, message.step, "running", message.message);
    },

    isFrozen() {
      return current?.frozen === true;
    },

    movedTo() {
      const move = current;
      if (
        move === null ||
        move.status.state !== "completed" ||
        move.movedAt === null
      ) {
        return null;
      }
      return {
        serverUrl: move.status.serverUrl,
        toHostName: move.status.targetHostName,
        movedAt: move.movedAt,
      };
    },

    resolveDownload(args) {
      const move = current;
      if (
        move === null ||
        move.status.moveId !== args.moveId ||
        move.status.state !== "preparing"
      ) {
        return { outcome: "not_found" };
      }
      if (move.status.targetHostId !== args.hostId) {
        return { outcome: "forbidden" };
      }
      const artifact = args.kind === "archive" ? move.archive : move.bbApp;
      if (artifact === null) {
        return { outcome: "not_found" };
      }
      return {
        outcome: "found",
        download: {
          path: artifact.path,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
        },
      };
    },

    async start(request) {
      if (starting || isBlocking(current)) {
        throw inProgressError();
      }
      starting = true;
      try {
        const check = await runServerMoveCheck(checkEnvironment, {
          moveInProgress: false,
          request,
        });
        const blockers: ServerMoveCheckItem[] = check.response.items.filter(
          (item) => item.severity === "blocker",
        );
        const existingData = check.response.existingTargetServerData;
        if (
          blockers.length === 0 &&
          existingData !== null &&
          !request.archiveExistingTargetServerData
        ) {
          blockers.push({
            id: "archive-existing-data-required",
            severity: "blocker",
            title: `Confirm archiving the existing bb data on ${check.response.targetHostName}`,
            detail: existingData.path,
          });
        }
        if (blockers.length > 0) {
          throw new ApiError(
            400,
            "server_move_blocked",
            blockers[0]?.title ?? "The server can't move to this machine",
            { details: { items: blockers } },
          );
        }
        const { mode, serverUrl, sourceServerHost, targetHost } = check;
        if (
          sourceServerHost === null ||
          targetHost === null ||
          serverUrl === null ||
          mode.mode === "unavailable"
        ) {
          throw new Error(
            "Server move check passed without a server machine, target, and address",
          );
        }
        const moveId = randomUUID();
        const move: MoveRun = {
          abort: new AbortController(),
          activationToken: randomBytes(32).toString("base64url"),
          archive: null,
          archiveExistingTargetServerData:
            request.archiveExistingTargetServerData,
          bbApp: null,
          connectHandle: mode.mode === "connect" ? mode.connectHandle : null,
          finished: false,
          frozen: false,
          grant: null,
          movedAt: null,
          pluginsSuspended: false,
          sourceServerHost: {
            id: sourceServerHost.id,
            name: sourceServerHost.name,
          },
          status: {
            moveId,
            state: "preparing",
            mode: mode.mode,
            targetHostId: targetHost.id,
            targetHostName: targetHost.name,
            serverUrl,
            startedAt: environment.now(),
            finishedAt: null,
            error: null,
            steps: createSteps(),
            cancellable: true,
          },
          workDir: join(deps.config.dataDir, SERVER_MOVE_WORK_DIR_NAME, moveId),
        };
        current = move;
        notify();
        void run(move);
        return structuredClone(move.status);
      } finally {
        starting = false;
      }
    },
  };
}
