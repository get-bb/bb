import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeOptions,
} from "@bb/agent-runtime";
import type { AvailableModel, ProviderInfo } from "@bb/domain";
import type { EventSinkInput } from "./event-sink.js";
import type {
  HostDaemonCommand,
  HostDaemonInjectedSkillSource,
  HostDaemonOnlineRpcCommand,
  WorkspaceContext,
} from "@bb/host-daemon-contract";
import { getPersonalWorkspaceRoot } from "@bb/host-workspace";
import type { WorkflowJournalEntry } from "@bb/workflow-runtime";
import type { InteractiveResolveCommandInput } from "./interactive-request-registry.js";
import { RuntimeManager, type RuntimeEntry } from "./runtime-manager.js";
import type { TerminalManager } from "./terminals/terminal-manager.js";
import type { WorkflowRunManager } from "./workflow-run-manager.js";
import type { FetchProjectAttachment } from "./project-attachments.js";

type DispatchCommand = HostDaemonCommand | HostDaemonOnlineRpcCommand;

export type CommandOf<TType extends DispatchCommand["type"]> = Extract<
  DispatchCommand,
  { type: TType }
>;

export interface EventSink {
  emit: (event: EventSinkInput) => void;
  flush: () => Promise<void>;
}

export const noopEventSink: EventSink = {
  emit: () => undefined,
  flush: async () => undefined,
};

export interface FetchWorkflowRunJournalArgs {
  runId: string;
}

export interface CommandDispatchOptions {
  dataDir: string;
  fetchProjectAttachment: FetchProjectAttachment;
  runtimeManager: RuntimeManager;
  terminalManager?: Pick<TerminalManager, "closeEnvironmentTerminals">;
  /** Absent only in embeddings that never receive workflow.* commands (tests). */
  workflowRunManager?: Pick<
    WorkflowRunManager,
    "startRun" | "cancelRun" | "pruneRunDir"
  >;
  /** Fetches the server-authoritative resume journal (daemon→server internal
   *  route); absent only alongside an absent workflowRunManager. */
  fetchWorkflowRunJournal?: (
    args: FetchWorkflowRunJournalArgs,
  ) => Promise<WorkflowJournalEntry[]>;
  eventSink: EventSink;
  listModels?: (args: { providerId: string }) => Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;
  listProviders?: () => ProviderInfo[];
  resolveInteractiveRequest?: (
    request: InteractiveResolveCommandInput,
  ) => Promise<void>;
  threadStorageRootPath: string;
}

export class CommandDispatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandDispatchError";
  }
}

export class ExpectedCommandDispatchError extends CommandDispatchError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ExpectedCommandDispatchError";
  }
}

export function isExpectedCommandDispatchError(
  error: unknown,
): error is ExpectedCommandDispatchError {
  return error instanceof ExpectedCommandDispatchError;
}

const EXPECTED_ONLINE_RPC_FAILURE_CODES = new Set(["provision_cancelled"]);

export function isExpectedOnlineRpcFailureError(error: unknown): boolean {
  return (
    isExpectedCommandDispatchError(error) ||
    EXPECTED_ONLINE_RPC_FAILURE_CODES.has(getErrorCode(error))
  );
}

const MISSING_EXECUTABLE_PATTERN = /\bENOENT\b/;
const SPAWN_PATTERN = /\bspawn\b/;

const defaultModelListRuntimes = new Map<string, AgentRuntime>();

export async function shutdownDefaultListModelsRuntimes(): Promise<void> {
  const runtimes = [...defaultModelListRuntimes.values()];
  defaultModelListRuntimes.clear();
  await Promise.all(runtimes.map((runtime) => runtime.shutdown()));
}

export async function defaultListModels(
  args: { providerId: string },
  options: { bridgeBundleDir?: AgentRuntimeOptions["bridgeBundleDir"] } = {},
): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  const runtimeKey = options.bridgeBundleDir ?? "";
  let runtime = defaultModelListRuntimes.get(runtimeKey);
  if (!runtime) {
    runtime = createAgentRuntime({
      bridgeBundleDir: options.bridgeBundleDir,
      workspacePath: process.cwd(),
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [],
        success: true,
      }),
    });
    defaultModelListRuntimes.set(runtimeKey, runtime);
  }
  try {
    return await runtime.listModels(args);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unsupported provider")
    ) {
      throw new CommandDispatchError("unknown_provider", error.message);
    }
    throw error;
  }
}

export function getErrorCode(error: unknown): string {
  if (error instanceof CommandDispatchError) {
    return error.code;
  }
  if (isStructuredSpawnMissingExecutableError(error)) {
    return "missing_executable";
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (isMessageOnlySpawnMissingExecutableError(error)) {
    return "missing_executable";
  }
  return "command_failed";
}

function isStructuredSpawnMissingExecutableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    "code" in error &&
    error.code === "ENOENT" &&
    "syscall" in error &&
    typeof error.syscall === "string" &&
    error.syscall.startsWith("spawn")
  );
}

function isMessageOnlySpawnMissingExecutableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    MISSING_EXECUTABLE_PATTERN.test(error.message) &&
    SPAWN_PATTERN.test(error.message)
  );
}

export async function requireExistingEnvironment(
  environmentId: string,
  runtimeManager: RuntimeManager,
): Promise<RuntimeEntry> {
  const entry = await runtimeManager.getOrAwait(environmentId);
  if (!entry) {
    throw new CommandDispatchError(
      "unknown_environment",
      `No runtime exists for environment ${environmentId}`,
    );
  }
  return entry;
}

export async function requireWorkspaceEnvironment(
  args: {
    dataDir?: string;
    environmentId: string;
    injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
    /**
     * Set by thread commands that resolve with injectedSkillSources, so a
     * busy runtime is reused instead of conflicting; see EnsureEnvironmentArgs.
     */
    targetThreadId?: string;
    workspaceContext: WorkspaceContext;
  },
  runtimeManager: RuntimeManager,
): Promise<RuntimeEntry> {
  const existing = await runtimeManager.getOrAwait(args.environmentId);
  if (existing) {
    if (existing.path !== args.workspaceContext.workspacePath) {
      await runtimeManager.forgetEnvironment(args.environmentId);
      throw new ExpectedCommandDispatchError(
        "workspace_type_mismatch",
        `Loaded environment ${args.environmentId} is bound to ${existing.path}, not ${args.workspaceContext.workspacePath}`,
      );
    }
  }

  return runtimeManager.ensureEnvironment({
    environmentId: args.environmentId,
    ...(args.injectedSkillSources !== undefined
      ? { injectedSkillSources: args.injectedSkillSources }
      : {}),
    ...(args.targetThreadId !== undefined
      ? { targetThreadId: args.targetThreadId }
      : {}),
    ...(args.dataDir
      ? { personalWorkspaceRoot: getPersonalWorkspaceRoot(args.dataDir) }
      : {}),
    workspacePath: args.workspaceContext.workspacePath,
    workspaceProvisionType: args.workspaceContext.workspaceProvisionType,
  });
}
