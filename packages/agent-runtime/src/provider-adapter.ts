import type {
  AvailableModel,
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  PromptInput,
  ClaudeCodeMockCliTrafficConfig,
  ProviderCapabilities,
  ReasoningLevel,
  RuntimePermissionPolicy,
  RuntimeThreadExecutionOptions,
  ServiceTier,
  ThreadEvent,
} from "@bb/domain";
import type {
  ProviderInboundRequest,
  ProviderRuntimeEvent,
  BuildInteractiveResponseArgs,
  DecodedInteractiveRequest,
  DecodedToolCallRequest,
  PreparedProviderCommandDispatch,
  ProviderCommandPlan,
  ProviderInteractiveResponse,
  ProviderPostInitializeRequest,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  AgentRuntimeBridgeLaunch,
  AgentRuntimeSkillRoot,
} from "./types.js";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

export interface ProviderTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

export interface ProviderAcceptedCommandTranslationArgs {
  command: AdapterCommand;
  providerThreadId?: string;
}

export interface ProviderAdapterFactoryOptions {
  additionalWorkspaceWriteRoots: readonly string[];
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  /**
   * A plugin-delivered bridge artifact resolved to a verified local path by
   * the host daemon. Routes prefix-matched non-first-party providers onto the
   * generic bridge-protocol adapter running that artifact.
   */
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  bridgeBundleDir?: string;
  bridgeNodeEnv?: Record<string, string>;
  bridgeNodeExecutablePath?: string;
  /** Streamed-text coalescing window override for the delta assembler. */
  textDeltaFlushMs?: number;
}

export type ProviderAdapterFactory = (
  providerId: string,
  options: ProviderAdapterFactoryOptions,
) => ProviderAdapter;

// ---------------------------------------------------------------------------
// AdapterCommand — what the runtime asks the adapter to build
// ---------------------------------------------------------------------------

export type ProviderExecutionContext = {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  claudeCodePermissionMode?: "plan";
  claudeCodeMockCliTraffic: ClaudeCodeMockCliTrafficConfig;
  /**
   * Server-owned workflows policy. Filled explicitly at the server boundary
   * and passed through required end-to-end; providers without the concept
   * receive (and ignore) an explicit false.
   */
  workflowsEnabled: boolean;
  memoryEnabled?: boolean;
  providerSubagentsEnabled?: boolean;
  instructions?: string;
  envVars?: Record<string, string>;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
} & RuntimePermissionPolicy;

export type AdapterCommand =
  | { type: "initialize" }
  | {
      type: "skills/configure";
      skillRoots: readonly AgentRuntimeSkillRoot[];
    }
  | { type: "model/list"; cwd?: string }
  | {
      type: "thread/start";
      threadId: string;
      cwd: string;
      input?: PromptInput[];
      options: ProviderExecutionContext;
      dynamicTools?: DynamicTool[];
      disallowedTools?: readonly string[];
      instructionMode: InstructionMode;
    }
  | {
      type: "thread/resume";
      threadId: string;
      cwd: string;
      providerThreadId: string;
      options: ProviderExecutionContext;
      dynamicTools?: DynamicTool[];
      disallowedTools?: readonly string[];
      instructionMode: InstructionMode;
    }
  | {
      type: "thread/fork";
      threadId: string;
      cwd: string;
      sourceProviderThreadId: string;
      sourceProviderCheckpointId?: string;
      options: ProviderExecutionContext;
      dynamicTools?: DynamicTool[];
      disallowedTools?: readonly string[];
      instructionMode: InstructionMode;
    }
  | {
      type: "turn/start";
      threadId: string;
      providerThreadId: string;
      input: PromptInput[];
      inputGroups?: PromptInput[][];
      clientRequestId: ClientTurnRequestId;
      options: ProviderExecutionContext;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string;
      expectedTurnId: string;
      input: PromptInput[];
      inputGroups?: PromptInput[][];
      clientRequestId: ClientTurnRequestId;
      options: ProviderExecutionContext;
    }
  | {
      type: "thread/stop";
      threadId: string;
      providerThreadId: string;
      /**
       * Non-null means the stop interrupted an active provider turn. Adapters
       * may treat that provider session as poisoned for future resume. Null
       * means idle/no-active-turn stop and should not invalidate the session.
       */
      activeTurnId: string | null;
    }
  | {
      type: "thread/discard";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread/goal/clear";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread/name/set";
      threadId: string;
      providerThreadId: string;
      title: string;
    }
  | {
      type: "thread/archive";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread/unarchive";
      threadId: string;
      providerThreadId: string;
    };

export type TurnStartAdapterCommand = Extract<
  AdapterCommand,
  { type: "turn/start" }
>;

export function flattenPromptInputGroups(
  input: PromptInput[],
  inputGroups: PromptInput[][] | undefined,
): PromptInput[] {
  if (inputGroups === undefined) {
    return input;
  }
  return inputGroups.flatMap((group, index) =>
    index === 0
      ? group
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...group],
  );
}

export function noPreparedProviderCommandDispatch(
  _command: TurnStartAdapterCommand,
): null {
  return null;
}

export type ProviderExecutionSettingsChange = "unchanged" | "live" | "session";

export interface ClassifyProviderExecutionSettingsChangeArgs {
  current: RuntimeThreadExecutionOptions;
  next: RuntimeThreadExecutionOptions;
}

// ---------------------------------------------------------------------------
// ProviderAdapter — internal extension contract
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  /**
   * Selects where approval escalation is enforced. `runtime` adapters emit
   * every approval request and rely on the runtime's current thread policy.
   * `provider` adapters enforce the policy before forwarding a request, so a
   * forwarded approval is already known to require user input and must not be
   * reclassified against mutable thread settings.
   */
  approvalEnforcedBy: "runtime" | "provider";
  /**
   * Normalizes provider-specific execution options before validation,
   * comparison, persistence, and command construction. Providers may use this
   * to collapse accepted no-op values onto their effective setting.
   */
  normalizeExecutionOptions?(
    options: RuntimeThreadExecutionOptions,
  ): RuntimeThreadExecutionOptions;
  /**
   * Classifies execution-setting drift for this provider. `live` settings are
   * carried by the next turn command; `session` settings require rebuilding
   * the provider session.
   */
  classifyExecutionSettingsChange(
    args: ClassifyProviderExecutionSettingsChangeArgs,
  ): ProviderExecutionSettingsChange;
  process: { command: string; args: string[]; env?: Record<string, string> };

  /**
   * Whether this thread owns provider work that can outlive its turn. Some
   * providers track that work by BB thread and others by provider session, so
   * both identifiers are given.
   */
  hasOpenThreadWork?(args: {
    providerThreadId: string;
    threadId: string;
  }): boolean;

  buildCommandPlan(command: AdapterCommand): ProviderCommandPlan;
  /**
   * Optional provider-specific reads performed after the protocol initialize
   * request and before any thread work starts. Best-effort requests let newer
   * providers hydrate adapter-local state without making older provider
   * versions unusable when they do not implement the read.
   */
  buildPostInitializeRequests?(): readonly ProviderPostInitializeRequest[];
  /**
   * Called immediately before a turn/start request is sent. Some providers
   * emit turn/started before the request promise resolves, so adapters that
   * need command-to-event correlation must prepare that state before dispatch.
   */
  prepareTurnStart(
    command: TurnStartAdapterCommand,
  ): PreparedProviderCommandDispatch | null;
  parseModelListResult(result: unknown): {
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  };
  translateEvent(
    event: ProviderRuntimeEvent,
    context?: ProviderTranslationContext,
  ): ThreadEvent[];
  /**
   * Returns normalized events implied by a successful provider command.
   * Use this for provider protocol gaps where accepted commands do not produce
   * their own notifications, such as accepted user input missing a userMessage.
   */
  translateAcceptedCommand(
    args: ProviderAcceptedCommandTranslationArgs,
  ): ThreadEvent[];
  /** Clears adapter-local turn state after the provider reports no active turn. */
  clearActiveTurnState?(threadId: string): void;
  /**
   * Called when a thread detaches because its provider process exited or the
   * runtime is shutting down. Returns events reconciling adapter state that
   * cannot survive the process — e.g. open background tasks settled as
   * interrupted. Events must carry the real bb threadId; the runtime emits
   * them before clearing the thread's runtime state.
   */
  buildThreadDetachedEvents?(args: { threadId: string }): ThreadEvent[];
  decodeToolCallRequest(
    request: ProviderInboundRequest,
  ): DecodedToolCallRequest | null;
  decodeInteractiveRequest?(
    request: ProviderInboundRequest,
  ): DecodedInteractiveRequest | null;
  buildInteractiveResponse?(
    args: BuildInteractiveResponseArgs,
  ): ProviderInteractiveResponse;
}
