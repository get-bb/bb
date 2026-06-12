import type {
  AvailableModel,
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  PendingInteractionCreate,
  PendingInteractionResolution,
  PromptInput,
  RuntimeThreadExecutionOptions,
  ThreadEvent,
  ToolCallRequest,
  ToolCallResponse,
} from "@bb/domain";

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

export type AgentRuntimeSkillRoot =
  | AgentRuntimeClaudeCodeSkillRoot
  | AgentRuntimeCodexSkillRoot
  | AgentRuntimePiSkillRoot;

/**
 * Final per-thread state snapshot taken when a provider process exits,
 * captured before the runtime clears the thread's state. This is the only
 * way consumers can see which turn a crashed thread was running.
 */
export interface AgentRuntimeProcessExitThreadState {
  activeTurnId: string | null;
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
}

// ---------------------------------------------------------------------------
// Runtime interface
// ---------------------------------------------------------------------------

export interface EnsureProviderArgs {
  providerId: string;
  forThreadId?: string;
}

export interface StartThreadArgs {
  environmentId: string;
  threadId: string;
  projectId: string;
  providerId: string;
  clientRequestId?: ClientTurnRequestId;
  input?: PromptInput[];
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
}

export interface StartThreadResult {
  providerThreadId: string;
}

export interface ResumeThreadArgs {
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
  clientRequestId: ClientTurnRequestId;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

export interface SteerTurnArgs {
  threadId: string;
  expectedTurnId: string;
  input: PromptInput[];
  clientRequestId: ClientTurnRequestId;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

export interface SteerTurnAppliedResult {
  status: "steered";
}

export interface SteerTurnStaleResult {
  status: "stale";
  activeTurnId: string | null;
}

export type SteerTurnResult = SteerTurnAppliedResult | SteerTurnStaleResult;

export interface StopThreadArgs {
  threadId: string;
}

export interface AgentRuntimeProviderSession {
  providerId: string;
  providerThreadId: string;
}

export interface WaitForActiveTurnArgs {
  timeoutMs: number;
}

export interface RenameThreadArgs {
  threadId: string;
  title: string;
}

export interface ArchiveThreadArgs {
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface UnarchiveThreadArgs {
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface ListModelsArgs {
  providerId: string;
}

export interface AgentRuntime {
  ensureProvider(args: EnsureProviderArgs): Promise<void>;

  startThread(args: StartThreadArgs): Promise<StartThreadResult>;

  resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult>;

  runTurn(args: RunTurnArgs): Promise<void>;

  steerTurn(args: SteerTurnArgs): Promise<SteerTurnResult>;

  /**
   * Stops the thread's active turn and removes the thread from the runtime:
   * identity, execution config, and turn state are cleared, so `hasThread`
   * reports `false` afterwards and the next turn must go through
   * `resumeThread`. The provider process keeps running for other threads.
   */
  stopThread(args: StopThreadArgs): Promise<void>;

  renameThread(args: RenameThreadArgs): Promise<void>;

  archiveThread(args: ArchiveThreadArgs): Promise<void>;

  unarchiveThread(args: UnarchiveThreadArgs): Promise<void>;

  listModels(args: ListModelsArgs): Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;

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

  /** Whether the runtime currently hosts the thread (turns can run on it). */
  hasThread(threadId: string): boolean;

  /** Thread ids with an active turn. */
  getActiveThreadIds(): string[];

  shutdown(): Promise<void>;
}
