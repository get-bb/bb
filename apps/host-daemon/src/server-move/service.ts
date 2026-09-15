import { timingSafeEqual } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { readBbAppRuntimeFile } from "@bb/config/app-runtime-file";
import { resolveCodexHome } from "@bb/config/codex-home";
import { isLoopbackHostname } from "@bb/config/loopback";
import { createNodeVerifiedProcessOps } from "@bb/config/verified-process-stop";
import type { ServerMoveStepId } from "@bb/domain";
import type {
  HostDaemonOnlineRpcResult,
  HostPlatform,
  ServerMoveProgressMessage,
} from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import {
  archiveExistingServerData,
  discardImportBackups,
  extractServerArchive,
  installImportedServerFiles,
  readServerImportFile,
  readServerImportJournalStatus,
  readServerMovedFile,
  removeImportedServerFiles,
  removeServerConnectHoldFile,
  removeServerImportJournalFile,
  rollBackServerImport,
  SERVER_IMPORT_BACKUP_DIR_NAME,
  SERVER_IMPORT_FILE_NAME,
  SERVER_MOVED_FILE_NAME,
  ServerArchiveError,
  writeLastServerMoveFile,
  writeServerImportFile,
  writeServerMovedFile,
} from "@bb/server-archive";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import { resolveHostPlatform } from "../host-platform.js";
import type { HostDaemonLogger } from "../logger.js";
import {
  defaultInstallTarball,
  defaultRunProcess,
} from "../protocol-self-update.js";
import type { FetchFn } from "../server-client.js";
import type { ServerMovedNotice } from "../server-connection-support.js";
import { downloadVerifiedFile } from "./download.js";
import {
  expandHomePath,
  isSameOrInsidePath,
  pathExists,
  removeEmptyDirectory,
  writeFileAtomically,
} from "./fs.js";
import {
  defaultGhAuthenticationCheck,
  defaultPortAvailabilityCheck,
  readDiskFreeBytes,
  readFileSizeBytes,
  type GhAuthenticationCheck,
  type PortAvailabilityCheck,
} from "./host-probes.js";
import {
  detectLauncherMovedMode,
  isLiveBbAppRuntime,
  serverUrlPort,
  type LauncherMovedMode,
  type LauncherProcessOps,
} from "./launcher-runtime.js";
import {
  restoreMachineConnectionConfig,
  rewriteManagedConfigServer,
  switchConfigToLocalServer,
} from "./managed-config.js";
import {
  incomingMoveDir,
  incomingMovesRoot,
  listIncomingMoveIds,
  readIncomingMoveState,
  requireMoveIdSegment,
  writeIncomingMoveState,
  type ActivationPlanKind,
  type IncomingMoveState,
} from "./move-state.js";
import {
  detectUnrecognizedSupervisor,
  normalizeMovedServerUrl,
  tryNormalizeMovedServerUrl,
  validateServerHeaders,
} from "./moved-server.js";
import {
  npmPrefixBbAppRoot,
  readBbAppVersion,
  resolveBbAppLauncherEntry,
  resolveFullBbAppPackage,
  resolvePackagedBbAppRoot,
  type BbAppPackageEntries,
} from "./package-layout.js";
import {
  createDefaultPendingServerLauncher,
  createPendingServerEnv,
  isProcessGroupAlive,
  readPendingServerMoveId,
  readServerMoveHealth,
  SERVER_MOVE_START_FAILED,
  stopProcessGroup,
  waitForPendingServer,
  type PendingServerLauncher,
} from "./pending-server.js";
import {
  buildServerStartArguments,
  findServiceDefinition,
  forcesNoServiceManager,
  formatServiceDefinitionContent,
  isServerStartDefinition,
  readHostDaemonPortArgument,
  replaceServerUrlArgument,
  SERVER_MOVE_SERVICE_MANAGER_ENV,
  writeServiceDefinition,
  type ServiceDefinition,
} from "./service-definition.js";
import {
  defaultDetachedProcessSpawner,
  defaultServerMoveCommandRunner,
  restartService,
  type DetachedProcessSpawner,
  type ServerMoveCommandRunner,
} from "./service-manager.js";

const PENDING_SERVER_TIMEOUT_MS = 3 * 60 * 1000;
const PENDING_SERVER_POLL_INTERVAL_MS = 500;
const PENDING_SERVER_STOP_TIMEOUT_MS = 10_000;
const PORT_RELEASE_TIMEOUT_MS = 15_000;
const PORT_RELEASE_POLL_INTERVAL_MS = 250;
const ACTIVATION_SESSION_CLOSE_TIMEOUT_MS = 90_000;
const SESSION_CLOSE_POLL_INTERVAL_MS = 250;
const PROBE_TIMEOUT_MS = 10_000;
const PROGRESS_INTERVAL_MS = 1_000;
const BB_APP_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const SERVER_DATABASE_PATHS = ["bb.db", "bb.db-wal", "bb.db-shm"] as const;
const HOST_ARTIFACT_DIGEST_FILE_NAME = "host-artifact.sha256";
const STANDALONE_DATA_DIR_NAME = ".bb";
const SERVER_DATABASE_FILE_NAME = "bb.db";
const SERVER_MOVE_LOG_FILE_NAME = "server-move.log";
const INSTALL_DAEMON_PID_FILE_NAME = "install-daemon.pid";
const PENDING_SERVER_LOG_FILE_NAME = "server-move-pending-server.log";
const ARCHIVE_FILE_NAME = "server-archive.tar.gz";
const STAGING_DIR_NAME = "staging";
const ACTIVATION_REJECTED = "server_move_activation_rejected";
const OLD_COPY_PROTECTED_ENTRIES: ReadonlySet<string> = new Set([
  "auth.json",
  "bb-app-runtime.json",
  "checkouts",
  "config.json",
  "daemon.lock",
  "env.json",
  "host-id",
  "last-server-move.json",
  "logs",
  "npm",
  "personal-workspaces",
  "runtime",
  "server-moved.json",
  "thread-storage",
  "worktrees",
]);

type ServerMoveLogger = Pick<HostDaemonLogger, "error" | "info" | "warn">;

export interface ServerMoveServiceOptions {
  dataDir: string;
  homeDir: string;
  hostId: string;
  serverUrl: string;
  hostKey: string;
  serverHeaders: Record<string, string>;
  hostDaemonPort: number | null;
  autoUpdate: boolean;
  env: NodeJS.ProcessEnv;
  platform: HostPlatform;
  uid: number;
  parentPid: number;
  daemonEntryPath: string | null;
  logger: ServerMoveLogger;
  fetchFn: FetchFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  runCommand: ServerMoveCommandRunner;
  spawnDetached: DetachedProcessSpawner;
  launchPendingServer: PendingServerLauncher;
  installBbApp: (tarballPath: string) => Promise<void>;
  checkGhAuthenticated: GhAuthenticationCheck;
  checkPortAvailable: PortAvailabilityCheck;
  processOps: LauncherProcessOps;
  isServerSessionOpen: () => boolean;
  getShellEnv: () => NodeJS.ProcessEnv;
  emitProgress: (message: ServerMoveProgressMessage) => void;
  requestShutdown: (reason: string, exitCode: 0 | 1) => Promise<void>;
  pendingServerTimeoutMs: number;
  portReleaseTimeoutMs: number;
  activationSessionCloseTimeoutMs: number;
}

export type ServerMoveServiceDefaults = Pick<
  ServerMoveServiceOptions,
  | "homeDir"
  | "env"
  | "platform"
  | "uid"
  | "parentPid"
  | "daemonEntryPath"
  | "fetchFn"
  | "now"
  | "sleep"
  | "runCommand"
  | "spawnDetached"
  | "launchPendingServer"
  | "installBbApp"
  | "checkGhAuthenticated"
  | "checkPortAvailable"
  | "processOps"
  | "pendingServerTimeoutMs"
  | "portReleaseTimeoutMs"
  | "activationSessionCloseTimeoutMs"
>;

export function defaultServerMoveServiceOptions(): ServerMoveServiceDefaults {
  return {
    homeDir: homedir(),
    env: process.env,
    platform: resolveHostPlatform(),
    uid: process.getuid?.() ?? 0,
    parentPid: process.ppid,
    daemonEntryPath: process.argv[1] ?? null,
    fetchFn: fetch,
    now: Date.now,
    sleep: (ms) => sleep(ms),
    runCommand: defaultServerMoveCommandRunner,
    spawnDetached: defaultDetachedProcessSpawner,
    launchPendingServer: createDefaultPendingServerLauncher(
      defaultDetachedProcessSpawner,
    ),
    installBbApp: (tarballPath) =>
      defaultInstallTarball(tarballPath, defaultRunProcess),
    checkGhAuthenticated: defaultGhAuthenticationCheck,
    checkPortAvailable: defaultPortAvailabilityCheck,
    processOps: createNodeVerifiedProcessOps(),
    pendingServerTimeoutMs: PENDING_SERVER_TIMEOUT_MS,
    portReleaseTimeoutMs: PORT_RELEASE_TIMEOUT_MS,
    activationSessionCloseTimeoutMs: ACTIVATION_SESSION_CLOSE_TIMEOUT_MS,
  };
}

interface InFlightPrepare {
  activationToken: string;
  controller: AbortController;
  promise: Promise<HostDaemonOnlineRpcResult<"server_move.prepare">>;
}

interface RunningActivation {
  moveId: string;
  promise: Promise<void>;
}

type ActivatingState = IncomingMoveState & {
  activation: NonNullable<IncomingMoveState["activation"]>;
};

type ActivationPlan =
  | { kind: "launcher" }
  | {
      kind: "service";
      definition: ServiceDefinition;
      programArguments: string[];
    }
  | { kind: "replacement"; programArguments: string[] };

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePrepareError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) {
    return new ExpectedCommandDispatchError(
      "server_move_cancelled",
      "The server move was cancelled",
    );
  }
  if (error instanceof ServerArchiveError) {
    return new CommandDispatchError(
      `server_move_archive_${error.code}`,
      error.message,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isContainedIn(root: string, candidate: string): boolean {
  return candidate.startsWith(`${root}${sep}`);
}

function isActivatingState(state: IncomingMoveState): state is ActivatingState {
  return state.activation !== null;
}

function rejectActivation(message: string): ExpectedCommandDispatchError {
  return new ExpectedCommandDispatchError(ACTIVATION_REJECTED, message);
}

function sameArguments(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export class ServerMoveService {
  private readonly inFlightPrepares = new Map<string, InFlightPrepare>();
  private readonly spawnedPendingServerPids = new Set<number>();
  private activation: RunningActivation | null = null;
  private serverMovedLane: Promise<void> = Promise.resolve();
  private switchedToMovedServer = false;

  constructor(private readonly options: ServerMoveServiceOptions) {}

  async inspect(
    command: CommandOf<"server_move.inspect">,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.inspect">> {
    const { dataDir, homeDir } = this.options;
    const shellEnv = this.options.getShellEnv();
    const standaloneDataDir = join(homeDir, STANDALONE_DATA_DIR_NAME);
    const incomingMoveIds = await listIncomingMoveIds(dataDir);
    const staleMoves = await this.listStaleMoves();
    const journalStatus = await readServerImportJournalStatus(dataDir).catch(
      () => null,
    );
    const interruptedImport =
      journalStatus?.kind === "interrupted" ? journalStatus.journal : null;
    const staleImport =
      interruptedImport?.entries.includes(SERVER_DATABASE_FILE_NAME) === true ||
      staleMoves.some(
        (state) =>
          state.importedEntries?.includes(SERVER_DATABASE_FILE_NAME) === true,
      );
    const stalePendingPort = staleMoves.some(
      (state) =>
        state.pendingServer !== null && state.serverPort === command.port,
    );
    const movedMode = await this.detectLauncherMovedMode();
    const standaloneDatabaseSize = (await this.standaloneDataDirIsOwnDataDir())
      ? null
      : await readFileSizeBytes(
          join(standaloneDataDir, SERVER_DATABASE_FILE_NAME),
        );
    const [
      packageEntries,
      bbAppVersion,
      serviceDefinition,
      dataDirHasDatabase,
      oldServerCopyPending,
      importBackupPresent,
      portAvailable,
      ghAuthenticated,
      codexCredentialsPresent,
      pathsExist,
      diskFreeBytes,
    ] = await Promise.all([
      this.resolveServerPackage(),
      readBbAppVersion({
        env: this.options.env,
        packageRoot: resolvePackagedBbAppRoot(this.options.daemonEntryPath),
      }),
      this.findServiceDefinition(),
      this.dataDirHasDatabase(),
      this.oldServerCopyPending(),
      pathExists(join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME)),
      stalePendingPort || movedMode?.serverPort === command.port
        ? true
        : this.options.checkPortAvailable(command.port),
      this.options.checkGhAuthenticated(shellEnv),
      pathExists(join(resolveCodexHome(homeDir, shellEnv), "auth.json")),
      Promise.all(
        command.paths.map(
          async (path) =>
            [path, await pathExists(expandHomePath(path, homeDir))] as const,
        ),
      ),
      readDiskFreeBytes(dataDir),
    ]);
    const orphanedImportBackup =
      importBackupPresent &&
      interruptedImport === null &&
      incomingMoveIds.length === 0 &&
      this.inFlightPrepares.size === 0;
    return {
      dataDir,
      platform: this.options.platform,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      bbAppVersion,
      serverEntryAvailable: packageEntries !== null,
      serviceManager: serviceDefinition?.manager ?? "none",
      existingServerData:
        standaloneDatabaseSize === null
          ? null
          : { path: standaloneDataDir, sizeBytes: standaloneDatabaseSize },
      dataDirHasServerData:
        oldServerCopyPending ||
        orphanedImportBackup ||
        (dataDirHasDatabase && !staleImport),
      portAvailable,
      ghAuthenticated,
      codexCredentialsPresent,
      pathsExist: Object.fromEntries(pathsExist),
      diskFreeBytes,
    };
  }

  async probe(
    command: CommandOf<"server_move.probe">,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.probe">> {
    try {
      const health = await readServerMoveHealth({
        fetchFn: this.options.fetchFn,
        serverUrl: command.url,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (health?.moveId === command.moveId) {
        return { reachable: true, message: null, state: health.state };
      }
      return {
        reachable: false,
        message:
          health === null
            ? `${command.url} answered, but it is not the new bb server`
            : `${command.url} answered for a different server move`,
        state: null,
      };
    } catch (error) {
      return {
        reachable: false,
        message: `Could not reach ${command.url}: ${errorMessage(error)}`,
        state: null,
      };
    }
  }

  async prepare(
    command: CommandOf<"server_move.prepare">,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.prepare">> {
    const moveId = requireMoveIdSegment(command.moveId);
    const activating =
      this.activation?.moveId ??
      (await this.findActivatingState())?.moveId ??
      null;
    if (activating !== null) {
      throw new ExpectedCommandDispatchError(
        "server_move_already_activated",
        `Server move ${activating} was already activated on this machine`,
      );
    }
    const inFlight = this.inFlightPrepares.get(moveId);
    if (inFlight !== undefined) {
      if (!tokensEqual(inFlight.activationToken, command.activationToken)) {
        throw new ExpectedCommandDispatchError(
          "server_move_rejected",
          "A different activation token is already preparing this move",
        );
      }
      return inFlight.promise;
    }
    const otherMoveId = this.inFlightPrepares.keys().next().value;
    if (otherMoveId !== undefined) {
      throw new ExpectedCommandDispatchError(
        "server_move_busy",
        `This machine is already preparing server move ${otherMoveId}`,
      );
    }
    if (command.archiveExistingServerData) {
      if (await this.standaloneDataDirIsOwnDataDir()) {
        throw new ExpectedCommandDispatchError(
          "server_move_rejected",
          "The target's own data directory cannot be archived",
        );
      }
      await this.assertStandaloneDataDirNotRunning();
    }
    const controller = new AbortController();
    const promise = (async () => {
      const prepared = await this.readPreparedResult(command);
      if (prepared !== null) {
        return prepared;
      }
      await this.abortStaleMoves();
      return this.runPrepare(command, controller.signal);
    })().finally(() => {
      this.inFlightPrepares.delete(moveId);
    });
    this.inFlightPrepares.set(moveId, {
      activationToken: command.activationToken,
      controller,
      promise,
    });
    return promise;
  }

  async activate(
    command: CommandOf<"server_move.activate">,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.activate">> {
    const moveId = requireMoveIdSegment(command.moveId);
    const { dataDir } = this.options;
    const state = await readIncomingMoveState(dataDir, moveId);
    if (
      state === null ||
      !tokensEqual(state.activationToken, command.activationToken)
    ) {
      throw rejectActivation(
        `Server move ${moveId} is not prepared on this machine or the activation token does not match`,
      );
    }
    if (isActivatingState(state)) {
      void this.startActivation(state, false);
      return { ok: true };
    }
    const importFile = await readServerImportFile(dataDir).catch(() => null);
    if (
      state.pendingServer === null ||
      state.preparedAt === null ||
      importFile === null ||
      importFile.kind !== "move" ||
      importFile.moveId !== moveId ||
      importFile.activationToken === null ||
      !tokensEqual(importFile.activationToken, command.activationToken)
    ) {
      throw rejectActivation(
        `Server move ${moveId} is not prepared on this machine or the activation token does not match`,
      );
    }
    if (this.activation !== null) {
      throw rejectActivation(
        `Server move ${this.activation.moveId} is already activating on this machine`,
      );
    }
    const plan = await this.planActivation(state, null);
    const activatingState: ActivatingState = {
      ...state,
      activation: {
        lastMove: command.lastMove,
        plan: plan.kind,
        requestedAt: this.options.now(),
      },
    };
    await writeIncomingMoveState(dataDir, activatingState);
    void this.startActivation(activatingState, true);
    return { ok: true };
  }

  async abort(
    command: CommandOf<"server_move.abort">,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.abort">> {
    const moveId = requireMoveIdSegment(command.moveId);
    const alreadyActivated = new ExpectedCommandDispatchError(
      "server_move_already_activated",
      `Server move ${moveId} was already activated on this machine`,
    );
    if (this.activation?.moveId === moveId) {
      throw alreadyActivated;
    }
    const inFlight = this.inFlightPrepares.get(moveId);
    if (inFlight !== undefined) {
      inFlight.controller.abort();
      await inFlight.promise.catch(() => undefined);
    }
    const state = await readIncomingMoveState(this.options.dataDir, moveId);
    if (state === null) {
      return { ok: true };
    }
    if (isActivatingState(state)) {
      throw alreadyActivated;
    }
    await this.cleanupMove(state);
    return { ok: true };
  }

  async deleteOldCopy(): Promise<
    HostDaemonOnlineRpcResult<"server_move.delete_old_copy">
  > {
    const { dataDir } = this.options;
    const marker = await readServerMovedFile(dataDir);
    if (marker === null) {
      return { deleted: false };
    }
    const root = resolve(dataDir);
    for (const entry of marker.oldCopyEntries) {
      const target = resolve(root, ...entry.split("/"));
      const topLevel = entry.split("/")[0] ?? entry;
      if (
        !isContainedIn(root, target) ||
        OLD_COPY_PROTECTED_ENTRIES.has(topLevel)
      ) {
        this.options.logger.warn(
          { entry },
          "Skipping a protected entry while deleting the old server copy",
        );
        continue;
      }
      await rm(target, { recursive: true, force: true });
      if (entry.endsWith(".db")) {
        await Promise.all(
          ["-wal", "-shm", "-journal"].map((suffix) =>
            rm(`${target}${suffix}`, { force: true }),
          ),
        );
      }
    }
    await writeServerMovedFile(dataDir, { ...marker, oldCopyEntries: [] });
    this.options.logger.info(
      { moveId: marker.moveId, entries: marker.oldCopyEntries.length },
      "Deleted the old bb server copy",
    );
    return { deleted: true };
  }

  handleServerMoved(notice: ServerMovedNotice): Promise<void> {
    const task = this.serverMovedLane.then(() =>
      this.processServerMoved(notice),
    );
    this.serverMovedLane = task.catch(() => undefined);
    return task;
  }

  async resumeActivation(): Promise<void> {
    if (this.activation !== null) {
      return this.activation.promise;
    }
    const state = await this.findActivatingState();
    if (state === null) {
      return;
    }
    const importFile = await readServerImportFile(this.options.dataDir).catch(
      () => null,
    );
    if (importFile !== null && importFile.moveId !== state.moveId) {
      this.options.logger.error(
        { moveId: state.moveId, importMoveId: importFile.moveId },
        "Not resuming the server move activation: server-import.json belongs to another move",
      );
      return;
    }
    if (importFile === null && this.runsWithActivatedServer(state)) {
      await this.removeIncomingState(state);
      this.options.logger.info(
        { moveId: state.moveId },
        "Finished the server move: this daemon runs next to the activated server",
      );
      return;
    }
    this.options.logger.warn(
      { moveId: state.moveId },
      "Resuming an interrupted server move activation",
    );
    return this.startActivation(state, false);
  }

  private startActivation(
    state: ActivatingState,
    waitForSessionClose: boolean,
  ): Promise<void> {
    if (this.activation !== null) {
      return this.activation.promise;
    }
    const promise = this.runActivation(state, waitForSessionClose).catch(
      (error: unknown) => {
        this.options.logger.error(
          { err: error, moveId: state.moveId },
          "Server move activation failed after the old server committed the move",
        );
      },
    );
    this.activation = { moveId: state.moveId, promise };
    return promise;
  }

  private async runActivation(
    state: ActivatingState,
    waitForSessionClose: boolean,
  ): Promise<void> {
    const { dataDir } = this.options;
    if (waitForSessionClose) {
      await this.waitForServerSessionClose(state.moveId);
    }
    await this.stopPendingServer(state);
    try {
      await this.waitForPortRelease(state.serverPort, null);
    } catch (error) {
      this.options.logger.error(
        { err: error, moveId: state.moveId },
        "The imported server's port did not free up; exiting so the activation resumes on the next start",
      );
      await this.options.requestShutdown("server-move-activation-port-busy", 1);
      return;
    }
    await writeLastServerMoveFile(dataDir, {
      version: 1,
      ...state.activation.lastMove,
    });
    const plan = await this.planActivation(state, state.activation.plan);
    if (
      plan.kind === "service" &&
      !sameArguments(plan.definition.programArguments, plan.programArguments)
    ) {
      await writeServiceDefinition(plan.definition, plan.programArguments);
    }
    await switchConfigToLocalServer({
      dataDir,
      serverUrl: `http://127.0.0.1:${state.serverPort}`,
    });
    await discardImportBackups(dataDir);
    await removeServerConnectHoldFile(dataDir);
    await rm(join(dataDir, SERVER_IMPORT_FILE_NAME), { force: true });
    this.options.logger.info(
      { moveId: state.moveId, plan: plan.kind },
      "Activated the imported bb server; switching this machine to run it",
    );
    if (plan.kind === "launcher") {
      await rm(join(dataDir, SERVER_MOVED_FILE_NAME), { force: true });
      await this.removeIncomingState(state);
      await this.options.requestShutdown("server-move-activated", 0);
      return;
    }
    if (plan.kind === "replacement") {
      await this.spawnReplacement(plan.programArguments);
      await this.removeIncomingState(state);
      await this.options.requestShutdown("server-move-activated", 0);
      return;
    }
    if (
      !(await this.restartThroughServiceManager(
        { ...plan.definition, programArguments: plan.programArguments },
        "server-move-activated",
      ))
    ) {
      return;
    }
    await this.removeIncomingState(state);
  }

  private async planActivation(
    state: IncomingMoveState,
    fixedKind: ActivationPlanKind | null,
  ): Promise<ActivationPlan> {
    const { dataDir } = this.options;
    if ((await this.resolveServerPackage()) === null) {
      throw rejectActivation(
        "This machine's bb installation does not include the bb server",
      );
    }
    if (fixedKind === "launcher") {
      return { kind: "launcher" };
    }
    if (fixedKind === null) {
      const movedMode = await this.detectLauncherMovedMode();
      if (movedMode !== null) {
        if (movedMode.serverPort !== state.serverPort) {
          throw rejectActivation(
            `The bb launcher on this machine serves port ${String(movedMode.serverPort)}, but the move expects port ${state.serverPort}`,
          );
        }
        return { kind: "launcher" };
      }
    }
    let definition: ServiceDefinition | null;
    try {
      definition = await this.findServiceDefinition();
    } catch (error) {
      throw rejectActivation(
        `Could not read this machine's bb service definition: ${errorMessage(error)}`,
      );
    }
    if (definition !== null && fixedKind !== "replacement") {
      const hostDaemonPort =
        readHostDaemonPortArgument(definition.programArguments) ??
        this.options.hostDaemonPort;
      if (hostDaemonPort === null) {
        throw rejectActivation("This machine's host daemon port is unknown");
      }
      try {
        const programArguments = buildServerStartArguments(
          definition.programArguments,
          {
            dataDir,
            serverPort: state.serverPort,
            hostDaemonPort,
            bindHost: state.bindHost,
          },
        );
        formatServiceDefinitionContent(definition, programArguments);
        return { kind: "service", definition, programArguments };
      } catch (error) {
        throw rejectActivation(
          `Cannot switch ${definition.path} to run the bb server: ${errorMessage(error)}`,
        );
      }
    }
    if (fixedKind === "service") {
      throw new Error(
        `The bb service definition for ${dataDir} disappeared during activation`,
      );
    }
    if (fixedKind === null) {
      const supervisor = await this.detectUnrecognizedSupervisor();
      if (supervisor !== null) {
        throw rejectActivation(
          `This machine's bb runs under ${supervisor}, but no bb service definition for ${dataDir} was found`,
        );
      }
    }
    if (this.options.hostDaemonPort === null) {
      throw rejectActivation("This machine's host daemon port is unknown");
    }
    const launcherEntry = await this.resolveLauncherEntry();
    if (launcherEntry === null) {
      throw rejectActivation("No bb-app launcher was found on this machine");
    }
    return {
      kind: "replacement",
      programArguments: [
        launcherEntry,
        "start",
        "--data-dir",
        dataDir,
        "--server-port",
        String(state.serverPort),
        "--host-daemon-port",
        String(this.options.hostDaemonPort),
        ...(state.bindHost === null
          ? []
          : ["--server-bind-host", state.bindHost]),
      ],
    };
  }

  private async processServerMoved(notice: ServerMovedNotice): Promise<void> {
    if (this.switchedToMovedServer) {
      return;
    }
    const serverUrl = normalizeMovedServerUrl(notice.serverUrl);
    const headers =
      notice.headers === null ? null : validateServerHeaders(notice.headers);
    if (
      this.activation !== null ||
      (await this.findActivatingState()) !== null
    ) {
      this.options.logger.info(
        { serverUrl, source: notice.source },
        "Ignoring a server address change while this machine activates a server move",
      );
      return;
    }
    if (await pathExists(join(this.options.dataDir, SERVER_IMPORT_FILE_NAME))) {
      if (
        notice.source === "session-open" &&
        (await this.trySelfActivation(serverUrl, notice))
      ) {
        return;
      }
      this.options.logger.warn(
        { serverUrl, source: notice.source },
        "Ignoring a server address change while a server move is prepared on this machine",
      );
      return;
    }
    await this.switchToMovedServer(serverUrl, headers);
    this.switchedToMovedServer = true;
  }

  private async trySelfActivation(
    serverUrl: string,
    notice: Extract<ServerMovedNotice, { source: "session-open" }>,
  ): Promise<boolean> {
    const { dataDir } = this.options;
    const importFile = await readServerImportFile(dataDir).catch(() => null);
    if (
      importFile === null ||
      importFile.kind !== "move" ||
      importFile.moveId === null ||
      importFile.activationToken === null ||
      importFile.serverUrl === null ||
      importFile.sourceServerHostId === null ||
      tryNormalizeMovedServerUrl(importFile.serverUrl) !== serverUrl
    ) {
      return false;
    }
    const state = await readIncomingMoveState(dataDir, importFile.moveId).catch(
      () => null,
    );
    if (
      state === null ||
      state.pendingServer === null ||
      state.preparedAt === null ||
      state.activation !== null ||
      !tokensEqual(state.activationToken, importFile.activationToken)
    ) {
      return false;
    }
    let plan: ActivationPlan;
    try {
      plan = await this.planActivation(state, null);
    } catch (error) {
      this.options.logger.error(
        { err: error, moveId: state.moveId },
        "The old bb server moved to this machine, but this machine cannot start the server",
      );
      return true;
    }
    const activatingState: ActivatingState = {
      ...state,
      activation: {
        lastMove: {
          moveId: importFile.moveId,
          fromHostId: importFile.sourceServerHostId,
          fromHostName: importFile.sourceServerHostId,
          toHostId: this.options.hostId,
          toHostName: notice.toHostName,
          completedAt: notice.movedAt,
          oldCopyDeletedAt: null,
        },
        plan: plan.kind,
        requestedAt: this.options.now(),
      },
    };
    await writeIncomingMoveState(dataDir, activatingState);
    this.options.logger.warn(
      { moveId: state.moveId, serverUrl },
      "The old bb server committed the move to this machine without confirming; finishing activation",
    );
    void this.startActivation(activatingState, false);
    return true;
  }

  private emitProgress(
    moveId: string,
    step: ServerMoveStepId,
    message: string,
  ): void {
    this.options.emitProgress({
      type: "server_move.progress",
      moveId,
      step,
      message,
    });
  }

  private logPath(fileName: string): string {
    return join(this.options.dataDir, "logs", fileName);
  }

  private findServiceDefinition(): Promise<ServiceDefinition | null> {
    return findServiceDefinition({
      dataDir: this.options.dataDir,
      homeDir: this.options.homeDir,
      platform: this.options.platform,
      env: this.options.env,
    });
  }

  private detectLauncherMovedMode(): Promise<LauncherMovedMode | null> {
    return detectLauncherMovedMode({
      dataDir: this.options.dataDir,
      processOps: this.options.processOps,
    });
  }

  private detectUnrecognizedSupervisor(): Promise<string | null> {
    return detectUnrecognizedSupervisor({
      env: this.options.env,
      dataDir: this.options.dataDir,
      parentPid: this.options.parentPid,
    });
  }

  private standaloneDataDirIsOwnDataDir(): Promise<boolean> {
    return isSameOrInsidePath(
      this.options.dataDir,
      join(this.options.homeDir, STANDALONE_DATA_DIR_NAME),
    );
  }

  private async assertStandaloneDataDirNotRunning(): Promise<void> {
    const standaloneDataDir = join(
      this.options.homeDir,
      STANDALONE_DATA_DIR_NAME,
    );
    if (
      !(await pathExists(join(standaloneDataDir, SERVER_DATABASE_FILE_NAME)))
    ) {
      return;
    }
    const runtime = await readBbAppRuntimeFile(standaloneDataDir);
    if (
      runtime === null ||
      !(await isLiveBbAppRuntime(runtime, this.options.processOps))
    ) {
      return;
    }
    throw new ExpectedCommandDispatchError(
      "server_move_rejected",
      `bb is running from ${standaloneDataDir} on this machine (pid ${runtime.pid}). Quit bb there first, then start the move again.`,
    );
  }

  private async dataDirHasDatabase(): Promise<boolean> {
    const present = await Promise.all(
      SERVER_DATABASE_PATHS.map((path) =>
        pathExists(join(this.options.dataDir, path)),
      ),
    );
    return present.some(Boolean);
  }

  private async oldServerCopyPending(): Promise<boolean> {
    const marker = await readServerMovedFile(this.options.dataDir).catch(
      () => null,
    );
    return marker !== null && marker.oldCopyEntries.length > 0;
  }

  private async findActivatingState(): Promise<ActivatingState | null> {
    for (const moveId of await listIncomingMoveIds(this.options.dataDir)) {
      const state = await readIncomingMoveState(
        this.options.dataDir,
        moveId,
      ).catch(() => null);
      if (state !== null && isActivatingState(state)) {
        return state;
      }
    }
    return null;
  }

  private runsWithActivatedServer(state: IncomingMoveState): boolean {
    try {
      return (
        isLoopbackHostname(new URL(this.options.serverUrl).hostname) &&
        serverUrlPort(this.options.serverUrl) === state.serverPort
      );
    } catch {
      return false;
    }
  }

  private async waitForServerSessionClose(moveId: string): Promise<void> {
    const deadline =
      this.options.now() + this.options.activationSessionCloseTimeoutMs;
    while (this.options.isServerSessionOpen()) {
      if (this.options.now() >= deadline) {
        this.options.logger.warn(
          { moveId },
          "The old server session is still open; continuing the activation",
        );
        return;
      }
      await this.options.sleep(SESSION_CLOSE_POLL_INTERVAL_MS);
    }
  }

  private async waitForPortRelease(
    port: number,
    signal: AbortSignal | null,
  ): Promise<void> {
    const deadline = this.options.now() + this.options.portReleaseTimeoutMs;
    while (true) {
      signal?.throwIfAborted();
      if (await this.options.checkPortAvailable(port)) {
        return;
      }
      if (this.options.now() >= deadline) {
        throw new CommandDispatchError(
          SERVER_MOVE_START_FAILED,
          `Port ${port} is still in use on this machine after ${Math.round(this.options.portReleaseTimeoutMs / 1000)}s. Stop whatever answers on that port (for bb, restart bb on this machine), then start the move again.`,
        );
      }
      await this.options.sleep(PORT_RELEASE_POLL_INTERVAL_MS);
    }
  }

  private async removeIncomingState(state: IncomingMoveState): Promise<void> {
    await rm(incomingMoveDir(this.options.dataDir, state.moveId), {
      recursive: true,
      force: true,
    });
    await removeEmptyDirectory(incomingMovesRoot(this.options.dataDir));
  }

  private packageRoots(): string[] {
    const roots = new Set<string>();
    const npmPrefix = this.npmPrefix();
    if (npmPrefix !== null) {
      roots.add(npmPrefixBbAppRoot(npmPrefix));
    }
    const packagedRoot = resolvePackagedBbAppRoot(this.options.daemonEntryPath);
    if (packagedRoot !== null) {
      roots.add(packagedRoot);
    }
    return [...roots];
  }

  private npmPrefix(): string | null {
    const npmPrefix = this.options.env.BB_APP_NPM_PREFIX?.trim();
    return npmPrefix !== undefined && npmPrefix !== "" && isAbsolute(npmPrefix)
      ? npmPrefix
      : null;
  }

  private async resolveServerPackage(): Promise<BbAppPackageEntries | null> {
    for (const root of this.packageRoots()) {
      const entries = await resolveFullBbAppPackage(root);
      if (entries !== null) {
        return entries;
      }
    }
    return null;
  }

  private async resolveLauncherEntry(): Promise<string | null> {
    const npmPrefix = this.npmPrefix();
    if (npmPrefix !== null) {
      const npmBin = join(npmPrefix, "bin", "bb-app");
      if (await pathExists(npmBin)) {
        return npmBin;
      }
    }
    for (const root of this.packageRoots()) {
      const entry = await resolveBbAppLauncherEntry(root);
      if (entry !== null) {
        return entry;
      }
    }
    return null;
  }

  private replacementEnv(): NodeJS.ProcessEnv {
    const sanitized = sanitizeInheritedChildProcessEnv({
      env: this.options.env,
    });
    const executableDirectory = dirname(process.execPath);
    const npmPrefix = this.options.env.BB_APP_NPM_PREFIX;
    return {
      ...sanitized,
      PATH:
        sanitized.PATH === undefined
          ? executableDirectory
          : `${executableDirectory}${delimiter}${sanitized.PATH}`,
      BB_DATA_DIR: this.options.dataDir,
      ...(npmPrefix === undefined ? {} : { BB_APP_NPM_PREFIX: npmPrefix }),
      ...(forcesNoServiceManager(this.options.env)
        ? { [SERVER_MOVE_SERVICE_MANAGER_ENV]: "none" }
        : {}),
    };
  }

  private async listStaleMoves(): Promise<IncomingMoveState[]> {
    const states: IncomingMoveState[] = [];
    for (const moveId of await listIncomingMoveIds(this.options.dataDir)) {
      if (this.inFlightPrepares.has(moveId)) {
        continue;
      }
      const state = await readIncomingMoveState(
        this.options.dataDir,
        moveId,
      ).catch(() => null);
      if (state !== null && !isActivatingState(state)) {
        states.push(state);
      }
    }
    return states;
  }

  private async abortStaleMoves(): Promise<void> {
    for (const moveId of await listIncomingMoveIds(this.options.dataDir)) {
      const state = await readIncomingMoveState(
        this.options.dataDir,
        moveId,
      ).catch(() => null);
      if (state === null) {
        await rm(incomingMoveDir(this.options.dataDir, moveId), {
          recursive: true,
          force: true,
        });
        continue;
      }
      if (isActivatingState(state)) {
        continue;
      }
      this.options.logger.warn(
        { moveId },
        "Cleaning up an abandoned server move before preparing a new one",
      );
      await this.cleanupMove(state);
    }
    const interruptedImport = await rollBackServerImport(this.options.dataDir);
    if (interruptedImport !== null) {
      this.options.logger.warn(
        { entries: interruptedImport.entries.length },
        "Rolled back an interrupted server import before preparing a new move",
      );
    }
    await this.removeStaleConnectHold();
  }

  private async removeStaleConnectHold(): Promise<void> {
    if (!(await this.dataDirHasDatabase())) {
      await removeServerConnectHoldFile(this.options.dataDir);
    }
  }

  private async readPreparedResult(
    command: CommandOf<"server_move.prepare">,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.prepare"> | null> {
    const state = await readIncomingMoveState(
      this.options.dataDir,
      command.moveId,
    ).catch(() => null);
    if (
      state === null ||
      state.pendingServer === null ||
      state.preparedAt === null ||
      !tokensEqual(state.activationToken, command.activationToken) ||
      !isProcessGroupAlive(state.pendingServer.pid)
    ) {
      return null;
    }
    try {
      const moveId = await readPendingServerMoveId({
        fetchFn: this.options.fetchFn,
        serverUrl: state.pendingServer.localServerUrl,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return moveId === command.moveId
        ? {
            localServerUrl: state.pendingServer.localServerUrl,
            pid: state.pendingServer.pid,
          }
        : null;
    } catch {
      return null;
    }
  }

  private async runPrepare(
    command: CommandOf<"server_move.prepare">,
    signal: AbortSignal,
  ): Promise<HostDaemonOnlineRpcResult<"server_move.prepare">> {
    const { dataDir } = this.options;
    const moveDir = incomingMoveDir(dataDir, command.moveId);
    let state: IncomingMoveState = {
      version: 1,
      moveId: command.moveId,
      activationToken: command.activationToken,
      serverPort: command.serverPort,
      bindHost: command.bindHost,
      importedEntries: null,
      archivedServerData: null,
      pendingServer: null,
      preparedAt: null,
      activation: null,
    };
    const updateState = async (
      patch: Partial<IncomingMoveState>,
    ): Promise<void> => {
      state = { ...state, ...patch };
      await writeIncomingMoveState(dataDir, state);
    };
    try {
      await mkdir(moveDir, { recursive: true, mode: 0o700 });
      await updateState({});
      if (command.bbApp !== null) {
        await this.installBbApp(command, moveDir, signal);
      }
      const packageEntries = await this.resolveServerPackage();
      if (packageEntries === null) {
        throw new CommandDispatchError(
          "server_move_server_entry_unavailable",
          "This machine's bb installation does not include the bb server",
        );
      }
      const archivePath = join(moveDir, ARCHIVE_FILE_NAME);
      await this.download({
        moveId: command.moveId,
        step: "transfer",
        label: "server data",
        downloadPath: command.archive.downloadPath,
        destinationPath: archivePath,
        sha256: command.archive.sha256,
        sizeBytes: command.archive.sizeBytes,
        maxSizeBytes: Number.MAX_SAFE_INTEGER,
        signal,
      });
      signal.throwIfAborted();
      if (command.archiveExistingServerData) {
        const archivedServerData = await this.archiveStandaloneServerData(
          command.moveId,
        );
        if (archivedServerData !== null) {
          await updateState({ archivedServerData });
        }
      }
      this.emitProgress(
        command.moveId,
        "start-target",
        "Importing server data",
      );
      const stagingDir = join(moveDir, STAGING_DIR_NAME);
      await rm(stagingDir, { recursive: true, force: true });
      const manifest = await extractServerArchive({
        archivePath,
        destinationDir: stagingDir,
      });
      signal.throwIfAborted();
      const localServerUrl = `http://127.0.0.1:${command.serverPort}`;
      const installed = await installImportedServerFiles({
        stagingDir,
        dataDir,
        manifest,
        localServerUrl,
      });
      await updateState({ importedEntries: installed.importedEntries });
      await removeServerImportJournalFile(dataDir);
      await restoreMachineConnectionConfig({
        dataDir,
        backupConfigPath: join(
          dataDir,
          SERVER_IMPORT_BACKUP_DIR_NAME,
          "config.json",
        ),
      });
      await writeServerImportFile(dataDir, {
        version: 1,
        kind: "move",
        moveId: command.moveId,
        activationToken: command.activationToken,
        sourceDataDir: command.sourceDataDir,
        sourceServerHostId: command.sourceServerHostId,
        targetHostId: this.options.hostId,
        serverUrl: command.serverUrl,
        importedEntries: installed.importedEntries,
        createdAt: this.options.now(),
        fixupsAppliedAt: null,
      });
      await rm(stagingDir, { recursive: true, force: true });
      await rm(archivePath, { force: true });
      signal.throwIfAborted();
      if ((await this.detectLauncherMovedMode()) !== null) {
        this.emitProgress(
          command.moveId,
          "start-target",
          `Waiting for this machine's old server address on port ${command.serverPort} to close`,
        );
        await this.waitForPortRelease(command.serverPort, signal);
      }
      this.emitProgress(
        command.moveId,
        "start-target",
        "Starting the imported server",
      );
      const logPath = this.logPath(PENDING_SERVER_LOG_FILE_NAME);
      const pid = await this.options.launchPendingServer({
        bbServerEntry: packageEntries.bbServerEntry,
        dataDir,
        serverPort: command.serverPort,
        bindHost: command.bindHost,
        hostDaemonPort: this.options.hostDaemonPort,
        env: createPendingServerEnv(
          this.options.env,
          this.options.hostDaemonPort,
        ),
        logPath,
      });
      this.spawnedPendingServerPids.add(pid);
      await updateState({ pendingServer: { pid, localServerUrl } });
      await waitForPendingServer({
        fetchFn: this.options.fetchFn,
        localServerUrl,
        moveId: command.moveId,
        pid,
        logPath,
        timeoutMs: this.options.pendingServerTimeoutMs,
        pollIntervalMs: PENDING_SERVER_POLL_INTERVAL_MS,
        now: this.options.now,
        sleep: this.options.sleep,
        signal,
      });
      await updateState({ preparedAt: this.options.now() });
      this.emitProgress(
        command.moveId,
        "start-target",
        "The imported server is running",
      );
      return { localServerUrl, pid };
    } catch (error) {
      const normalized = normalizePrepareError(error, signal);
      this.options.logger.warn(
        { err: normalized, moveId: command.moveId },
        "Server move prepare failed; cleaning up",
      );
      await this.cleanupMove(state).catch((cleanupError: unknown) => {
        this.options.logger.error(
          { err: cleanupError, moveId: command.moveId },
          "Server move cleanup failed",
        );
      });
      throw normalized;
    }
  }

  private async installBbApp(
    command: CommandOf<"server_move.prepare">,
    moveDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    const bbApp = command.bbApp;
    if (bbApp === null) {
      return;
    }
    const tarballPath = join(moveDir, `bb-app-${bbApp.sha256}.tgz`);
    await this.download({
      moveId: command.moveId,
      step: "update-target",
      label: `bb ${bbApp.version}`,
      downloadPath: bbApp.downloadPath,
      destinationPath: tarballPath,
      sha256: bbApp.sha256,
      sizeBytes: null,
      maxSizeBytes: BB_APP_MAX_DOWNLOAD_BYTES,
      signal,
    });
    signal.throwIfAborted();
    this.emitProgress(
      command.moveId,
      "update-target",
      `Installing bb ${bbApp.version}`,
    );
    try {
      await this.options.installBbApp(tarballPath);
    } catch (error) {
      throw new CommandDispatchError(
        "server_move_install_failed",
        `Could not install bb ${bbApp.version}: ${errorMessage(error)}`,
      );
    }
    await rm(join(this.options.dataDir, HOST_ARTIFACT_DIGEST_FILE_NAME), {
      force: true,
    });
    await rm(tarballPath, { force: true });
    this.emitProgress(
      command.moveId,
      "update-target",
      `Installed bb ${bbApp.version}`,
    );
  }

  private async download(args: {
    moveId: string;
    step: ServerMoveStepId;
    label: string;
    downloadPath: string;
    destinationPath: string;
    sha256: string;
    sizeBytes: number | null;
    maxSizeBytes: number;
    signal: AbortSignal;
  }): Promise<void> {
    this.emitProgress(args.moveId, args.step, `Downloading ${args.label}`);
    let lastProgressAt = this.options.now();
    await downloadVerifiedFile({
      fetchFn: this.options.fetchFn,
      url: new URL(args.downloadPath, this.options.serverUrl).toString(),
      headers: {
        ...this.options.serverHeaders,
        authorization: `Bearer ${this.options.hostKey}`,
      },
      destinationPath: args.destinationPath,
      expectedSha256: args.sha256,
      expectedSizeBytes: args.sizeBytes,
      maxSizeBytes: args.maxSizeBytes,
      signal: args.signal,
      onProgress: (receivedBytes) => {
        const now = this.options.now();
        if (now - lastProgressAt < PROGRESS_INTERVAL_MS) {
          return;
        }
        lastProgressAt = now;
        this.emitProgress(
          args.moveId,
          args.step,
          args.sizeBytes === null
            ? `Downloading ${args.label} (${formatMegabytes(receivedBytes)})`
            : `Downloading ${args.label} (${formatMegabytes(receivedBytes)} of ${formatMegabytes(args.sizeBytes)})`,
        );
      },
    });
    this.emitProgress(args.moveId, args.step, `Downloaded ${args.label}`);
  }

  private async archiveStandaloneServerData(
    moveId: string,
  ): Promise<IncomingMoveState["archivedServerData"]> {
    const originalPath = resolve(
      this.options.homeDir,
      STANDALONE_DATA_DIR_NAME,
    );
    if (!(await pathExists(join(originalPath, SERVER_DATABASE_FILE_NAME)))) {
      return null;
    }
    await this.assertStandaloneDataDirNotRunning();
    this.emitProgress(
      moveId,
      "start-target",
      `Archiving the existing bb server data in ${originalPath}`,
    );
    const archivedPath = await archiveExistingServerData({
      dataDir: originalPath,
      now: this.options.now(),
    });
    return { originalPath, archivedPath };
  }

  private async stopPendingServer(state: IncomingMoveState): Promise<void> {
    const pendingServer = state.pendingServer;
    if (pendingServer === null || !isProcessGroupAlive(pendingServer.pid)) {
      return;
    }
    if (!this.spawnedPendingServerPids.has(pendingServer.pid)) {
      const moveId = await readPendingServerMoveId({
        fetchFn: this.options.fetchFn,
        serverUrl: pendingServer.localServerUrl,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        timeoutMs: PROBE_TIMEOUT_MS,
      }).catch(() => null);
      if (moveId !== state.moveId) {
        this.options.logger.warn(
          { moveId: state.moveId, pid: pendingServer.pid },
          "Not stopping a recorded pending server pid that no longer answers for this move",
        );
        return;
      }
    }
    await stopProcessGroup({
      pid: pendingServer.pid,
      timeoutMs: PENDING_SERVER_STOP_TIMEOUT_MS,
      sleep: this.options.sleep,
      now: this.options.now,
    });
    this.spawnedPendingServerPids.delete(pendingServer.pid);
  }

  private async cleanupMove(state: IncomingMoveState): Promise<void> {
    const { dataDir } = this.options;
    await this.stopPendingServer(state);
    if (state.importedEntries === null) {
      await rollBackServerImport(dataDir);
    } else {
      await removeImportedServerFiles({
        dataDir,
        importedEntries: state.importedEntries,
      });
    }
    await this.removeStaleConnectHold();
    const importFile = await readServerImportFile(dataDir).catch(() => null);
    if (importFile?.kind === "move" && importFile.moveId === state.moveId) {
      await rm(join(dataDir, SERVER_IMPORT_FILE_NAME), { force: true });
    }
    const archived = state.archivedServerData;
    if (
      archived !== null &&
      !(await pathExists(archived.originalPath)) &&
      (await pathExists(archived.archivedPath))
    ) {
      await rename(archived.archivedPath, archived.originalPath);
    }
    await this.removeIncomingState(state);
  }

  private async restartThroughServiceManager(
    definition: ServiceDefinition,
    reason: string,
  ): Promise<boolean> {
    this.options.logger.info(
      { manager: definition.manager, path: definition.path, reason },
      "Restarting the bb service with its updated definition",
    );
    try {
      await restartService({
        definition,
        runCommand: this.options.runCommand,
        spawnDetached: this.options.spawnDetached,
        uid: this.options.uid,
        env: this.options.env,
        logPath: this.logPath(SERVER_MOVE_LOG_FILE_NAME),
      });
      return true;
    } catch (error) {
      this.options.logger.error(
        { err: error, manager: definition.manager, path: definition.path },
        "The service manager could not restart bb; exiting so it restarts the daemon",
      );
      await this.options.requestShutdown(`${reason}-restart-failed`, 1);
      return false;
    }
  }

  private isLoopbackServerUrl(): boolean {
    try {
      return isLoopbackHostname(new URL(this.options.serverUrl).hostname);
    } catch {
      return false;
    }
  }

  private async switchToMovedServer(
    serverUrl: string,
    headers: Record<string, string> | null,
  ): Promise<void> {
    await rewriteManagedConfigServer({
      dataDir: this.options.dataDir,
      serverUrl,
      headers,
    });
    const definition = await this.findServiceDefinition();
    if (definition !== null && !isServerStartDefinition(definition)) {
      const updated = await writeServiceDefinition(
        definition,
        replaceServerUrlArgument(definition.programArguments, serverUrl),
      );
      await this.restartThroughServiceManager(updated, "server-moved");
      return;
    }
    if (
      definition !== null ||
      this.isLoopbackServerUrl() ||
      (await pathExists(join(this.options.dataDir, SERVER_MOVED_FILE_NAME)))
    ) {
      this.options.logger.info(
        { serverUrl },
        "The bb server moved; exiting so the bb-app launcher reconnects to the new server",
      );
      await this.options.requestShutdown("server-moved", 0);
      return;
    }
    const supervisor = await this.detectUnrecognizedSupervisor();
    if (supervisor !== null) {
      this.options.logger.warn(
        { serverUrl, supervisor },
        "The bb server moved, but this daemon runs under a service bb does not manage; updated config.json and exiting instead of starting a second daemon",
      );
      await this.options.requestShutdown("server-moved", 0);
      return;
    }
    const launcherEntry = await this.resolveLauncherEntry();
    if (launcherEntry === null) {
      this.options.logger.warn(
        { serverUrl },
        "The bb server moved, but this daemon has no bb-app launcher to restart through; exiting",
      );
      await this.options.requestShutdown("server-moved", 0);
      return;
    }
    await this.spawnReplacement([
      launcherEntry,
      "host-daemon",
      ...(this.options.autoUpdate ? ["--auto-update"] : []),
      ...(this.options.hostDaemonPort === null
        ? []
        : ["--host-daemon-port", String(this.options.hostDaemonPort)]),
      "--server-url",
      serverUrl,
    ]);
    await this.options.requestShutdown("server-moved", 0);
  }

  private async spawnReplacement(args: string[]): Promise<void> {
    const pid = await this.options.spawnDetached({
      command: process.execPath,
      args,
      env: this.replacementEnv(),
      logPath: this.logPath(SERVER_MOVE_LOG_FILE_NAME),
    });
    const pidFilePath = join(
      this.options.dataDir,
      INSTALL_DAEMON_PID_FILE_NAME,
    );
    if (await pathExists(pidFilePath)) {
      await writeFileAtomically({
        path: pidFilePath,
        content: `${pid}\n`,
        mode: 0o600,
      });
    }
    this.options.logger.info(
      { pid, args },
      "Started a replacement bb-app process for this machine",
    );
  }
}
