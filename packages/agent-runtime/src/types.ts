import type {
  PermissionMode,
  AvailableModel,
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  JsonObject,
  PendingInteractionCreate,
  PendingInteractionResolution,
  PromptInput,
  ProviderFork,
  ProviderRecoveryKind,
  RuntimeThreadExecutionOptions,
  ThreadEvent,
  ToolCallRequest,
  ToolCallResponse,
} from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import type {
  ExperimentalProviderHealthResult,
  ExperimentalProviderInstallationRunResult,
  ExperimentalProviderInstallationStatus,
  ExperimentalProviderUsageResult,
} from "@bb/provider-bridge-protocol";

export type AgentRuntimeShellEnvironment = Record<string, string>;

export type AgentRuntimeExecutionOptions = RuntimeThreadExecutionOptions;

export interface AgentRuntimeCodexSkillRoot {
  id: string;
  providerId: "codex";
  skillDirectoryRootPath: string;
}

export interface AgentRuntimeClaudeCodeSkillRoot {
  id: string;
  providerId: "claude-code";
  localPluginPath: string;
}

export interface AgentRuntimePiSkillRoot {
  id: string;
  providerId: "pi";
  skillDirectoryRootPath: string;
}

export interface AgentRuntimeAcpSkill {
  description: string;
  name: string;
}

export interface AgentRuntimeAcpSkillRoot {
  id: string;
  providerId: "acp";
  skillDirectoryRootPath: string;
  skills: readonly AgentRuntimeAcpSkill[];
}

export type AgentRuntimeSkillRoot =
  | AgentRuntimeAcpSkillRoot
  | AgentRuntimeClaudeCodeSkillRoot
  | AgentRuntimeCodexSkillRoot
  | AgentRuntimePiSkillRoot;

/**
 * Final per-thread state snapshot taken when a provider process exits,
 * captured before the runtime clears the thread's state. This is the only way
 * consumers can distinguish an idle session from a crashed active turn or a
 * turn request awaiting its first provider lifecycle event.
 */
export interface AgentRuntimeProcessExitThreadState {
  activeTurnId: string | null;
  pendingTurnStart: boolean;
  providerThreadId: string | null;
  threadId: string;
}

export interface AgentRuntimeProcessExitInfo {
  providerId: string;
  threads: AgentRuntimeProcessExitThreadState[];
  code: number | null;
  expected: boolean;
  signal: string | null;
  stderr: string | null;
}

// ---------------------------------------------------------------------------
// Runtime options
// ---------------------------------------------------------------------------

export interface AgentRuntimeOptions {
  /** Working directory for provider processes. */
  workspacePath: string;

  /** Extra paths workspace-write providers may mutate in addition to workspacePath. */
  additionalWorkspaceWriteRoots?: readonly string[];

  /** Environment variables passed to ALL provider processes. */
  env?: Record<string, string>;

  /** Environment variables injected into agent shell execution via adapters. */
  shellEnv?: AgentRuntimeShellEnvironment;

  /** Root directory containing per-thread storage directories. */
  threadStorageRootPath?: string;

  /** Optional directory containing bundled provider bridges. */
  bridgeBundleDir?: string;
  /**
   * Bounds for the turn-start watchdog (visible system/error when an
   * accepted turn never starts). Defaults: 120s threshold, 15s sweep.
   */
  turnStartWatchdog?: { thresholdMs?: number; intervalMs?: number };

  /** Optional caller-provided skill roots to expose to provider sessions. */
  skillRoots?: readonly AgentRuntimeSkillRoot[];

  /** Called when a provider emits a translated event.
   *  Every event has `threadId` (bb ID) and `providerThreadId` (provider's internal ID). */
  onEvent: (event: ThreadEvent) => void;

  /** Called when a provider needs to execute a tool.
   *  `threadId` is always the BB thread id and `providerThreadId` is always present. */
  onToolCall: (request: ToolCallRequest) => Promise<ToolCallResponse>;

  /** Called when a provider pauses for user permission or approval.
   *  The runtime converts provider-native requests into bb's shared pending-interaction contract. */
  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;

  /** Called on provider stderr lines. */
  onStderr?: (line: string, threadId?: string) => void;

  /** Called when a provider process exits unexpectedly. */
  onProcessExit?: (info: AgentRuntimeProcessExitInfo) => void;

  /**
   * Called when a bridge raises a typed `provider/recovery` hint. The runtime
   * parses and forwards; it does not act on the kind yet (the recovery
   * actions — unarchive-and-retry, bridge restart, stale-steer drop, retry
   * scheduling — land with the runtime cleanup workstream). A runtime signal,
   * never a timeline event.
   */
  onProviderRecovery?: (hint: AgentRuntimeProviderRecoveryHint) => void;
}

/**
 * A bridge's `provider/recovery` notification, stamped with the provider it
 * came from. `threadId` is the bb thread for session-scoped hints
 * (`sessionArchived`, `staleTurn`) and absent for provider-wide ones
 * (`authRequired`, account-level `rateLimited`).
 */
export interface AgentRuntimeProviderRecoveryHint {
  providerId: string;
  threadId?: string;
  kind: ProviderRecoveryKind;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Runtime interface
// ---------------------------------------------------------------------------

/**
 * A plugin-delivered provider bridge, resolved by the host daemon: the bridge
 * artifact has been downloaded, hash-verified, and cached at `artifactPath`.
 * Rides per-call like the ACP launch spec; `sha256` keys process identity so
 * a plugin update (new artifact hash) gets a fresh bridge process.
 */
export interface AgentRuntimeBridgeLaunch {
  /** The plugin that ships this bridge. Scopes the process's directories. */
  pluginId: string;
  /**
   * This plugin's persistent bridge directory on this host, already created by
   * the daemon. The bootstrap hands it to the bridge; the matching temp dir is
   * this process's own and is created and removed by the bootstrap.
   */
  dataDir: string;
  /**
   * Which bridge binary to run, as the server decided it: a hash-verified
   * plugin artifact already cached on this host, or a bridge inside the
   * daemon's own bundle (Pi).
   */
  source:
    | { kind: "artifact"; digest: string; artifactPath: string }
    | { kind: "daemon-bundled"; id: string };
  /** Server-validated capabilities from the provider declaration. */
  capabilities: {
    experimental_providerInstallation: boolean;
    supportsServiceTier: boolean;
    permissionModes: PermissionMode[];
    supportsThreadArchive: boolean;
    supportsThreadRename: boolean;
    fork: ProviderFork;
  };
  /** Provider-owned statics; interpreted only by the provider bridge. */
  providerOptions: JsonObject;
  /**
   * Daemon environment variable names the bridge may read. Provider
   * processes are spawned with every inherited `BB_*` variable stripped;
   * exactly these are forwarded from the daemon's own environment.
   */
  envPassthrough: readonly string[];
}

export interface EnsureProviderArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  /**
   * Providers with thread-scoped processes use this to start the process for a
   * specific bb thread. Omit it for provider-scoped maintenance work such as
   * model listing.
   */
  forThreadId?: string;
  providerId: string;
}

export interface StartThreadArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  environmentId: string;
  threadId: string;
  projectId: string;
  providerId: string;
  clientRequestId?: ClientTurnRequestId;
  input?: PromptInput[];
  inputGroups?: PromptInput[][];
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
  /**
   * Present means fork the new thread from this source provider session
   * instead of starting fresh; absent means a normal start.
   */
  fork?: { sourceProviderThreadId: string };
}

export interface StartThreadResult {
  providerThreadId: string;
}

interface PrepareThreadRewindArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  environmentId: string;
  threadId: string;
  leaseId: string;
  projectId: string;
  providerId: string;
  sourceProviderThreadId: string;
  retainThroughProviderCheckpoint: string;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
}

interface PrepareThreadRewindResult {
  providerThreadId: string;
}

interface DiscardThreadRewindArgs {
  leaseId: string;
}

export interface ResumeThreadArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  environmentId: string;
  threadId: string;
  projectId?: string;
  providerThreadId?: string;
  providerId: string;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
}

export interface ResumeThreadResult {
  providerThreadId: string;
}

export interface RunTurnArgs {
  threadId: string;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  clientRequestId: ClientTurnRequestId;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

export interface SteerTurnArgs {
  threadId: string;
  expectedTurnId: string;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  clientRequestId: ClientTurnRequestId;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

interface SteerTurnAppliedResult {
  status: "steered";
}

interface SteerTurnStaleResult {
  status: "stale";
  activeTurnId: string | null;
}

export type SteerTurnResult = SteerTurnAppliedResult | SteerTurnStaleResult;

export interface StopThreadArgs {
  threadId: string;
}

export interface StopThreadResult {
  providerCheckpointId: string | null;
}

export interface AgentRuntimeProviderSession {
  providerId: string;
  providerThreadId: string;
}

export interface WaitForActiveTurnArgs {
  timeoutMs: number;
}

export interface ReapIdleProviderSessionsArgs {
  idleForMs: number;
  nowMs: number;
  providerSessionReapingEnabled: boolean;
  runThreadExclusive?: (
    threadId: string,
    work: () => Promise<ReapedIdleProviderSession | null>,
  ) => Promise<ReapedIdleProviderSession | null>;
}

export interface ReapedIdleProviderSession {
  idleForMs: number;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface ReapIdleProviderSessionsResult {
  reapedSessions: ReapedIdleProviderSession[];
}

export interface RenameThreadArgs {
  threadId: string;
  title: string;
}

interface ClearThreadGoalArgs {
  threadId: string;
}

interface ArchiveThreadArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

interface UnarchiveThreadArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface ListModelsArgs {
  providerId: string;
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  cwd?: string;
}

interface ProviderMaintenanceArgs {
  providerId: string;
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  cwd?: string;
}

interface ProviderInstallationStatusArgs extends ProviderMaintenanceArgs {
  requirement?: "thread_rewind";
}

export interface AgentRuntime {
  ensureProvider(args: EnsureProviderArgs): Promise<void>;

  startThread(args: StartThreadArgs): Promise<StartThreadResult>;

  prepareThreadRewind(
    args: PrepareThreadRewindArgs,
  ): Promise<PrepareThreadRewindResult>;

  discardThreadRewind(args: DiscardThreadRewindArgs): Promise<void>;

  resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult>;

  runTurn(args: RunTurnArgs): Promise<void>;

  steerTurn(args: SteerTurnArgs): Promise<SteerTurnResult>;

  /**
   * Stops the thread's active turn and removes the thread from the runtime:
   * identity, execution config, and turn state are cleared, so `hasThread`
   * reports `false` afterwards and the next turn must go through
   * `resumeThread`. The provider process keeps running for other threads.
   */
  stopThread(args: StopThreadArgs): Promise<StopThreadResult>;

  clearThreadGoal(args: ClearThreadGoalArgs): Promise<{ cleared: boolean }>;

  renameThread(args: RenameThreadArgs): Promise<void>;

  archiveThread(args: ArchiveThreadArgs): Promise<void>;

  unarchiveThread(args: UnarchiveThreadArgs): Promise<void>;

  listModels(args: ListModelsArgs): Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;

  providerHealth(
    args: ProviderMaintenanceArgs,
  ): Promise<ExperimentalProviderHealthResult>;

  providerUsage(
    args: ProviderMaintenanceArgs,
  ): Promise<ExperimentalProviderUsageResult>;

  providerInstallationStatus(
    args: ProviderInstallationStatusArgs,
  ): Promise<ExperimentalProviderInstallationStatus>;

  providerInstallationRun(
    args: ProviderMaintenanceArgs & { action: "install" | "update" },
  ): Promise<ExperimentalProviderInstallationRunResult>;

  listRunningProviders(): string[];

  /** Active turn id for the thread, or `null` when no turn is running. */
  getActiveTurnId(threadId: string): string | null;

  /**
   * Resolves with the active turn id as soon as one is known: immediately if
   * a turn is already active, on the next `turn/started` observation
   * otherwise. Resolves `null` on timeout or when the thread goes idle
   * (stopped, cleared, or its provider process exits) before a turn starts.
   */
  waitForActiveTurn(
    threadId: string,
    args: WaitForActiveTurnArgs,
  ): Promise<string | null>;

  /** Provider identity for a hosted thread, or `null` when not hosted. */
  getProviderSession(threadId: string): AgentRuntimeProviderSession | null;

  /**
   * Stops idle live provider sessions without deleting bb thread state or
   * provider history. The next turn must resume from the persisted provider
   * thread id.
   */
  reapIdleProviderSessions(
    args: ReapIdleProviderSessionsArgs,
  ): Promise<ReapIdleProviderSessionsResult>;

  /** Whether the runtime currently hosts the thread (turns can run on it). */
  hasThread(threadId: string): boolean;

  /** Thread ids with an active turn or an accepted turn awaiting its first event. */
  getLiveThreadIds(): string[];

  /**
   * Whether any hosted thread still has an open background task (a workflow or
   * backgrounded command). These outlive their spawning turn, so a runtime with
   * no active turn can still be doing real work that a shutdown would destroy.
   */
  hasOpenBackgroundWork(): boolean;

  shutdown(): Promise<void>;
}
