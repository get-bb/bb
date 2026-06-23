import type {
  AvailableModel,
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  PendingInteractionPayload,
  PendingInteractionResolution,
  PromptInput,
  ClaudeCodeMockCliTrafficConfig,
  ProviderCapabilities,
  ReasoningLevel,
  RuntimePermissionPolicy,
  ServiceTier,
  ThreadEvent,
} from "@bb/domain";
import type {
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "./runtime-json-rpc.js";
import type { AgentRuntimeSkillRoot } from "./types.js";
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
  bridgeBundleDir?: string;
  bridgeNodeEnv?: Record<string, string>;
  bridgeNodeExecutablePath?: string;
  turnIdPrefix?: string;
}

export type ProviderAdapterFactory = (
  providerId: string,
  options: ProviderAdapterFactoryOptions,
) => ProviderAdapter;

export interface ProviderRequestCommandPlan {
  kind: "request";
  method: string;
  params?: object;
}

export interface ProviderNoopCommandPlan {
  kind: "noop";
  method?: never;
  params?: never;
  reason: string;
}

export type ProviderCommandPlan =
  | ProviderRequestCommandPlan
  | ProviderNoopCommandPlan;

export type ProviderInteractiveResponse =
  | boolean
  | number
  | string
  | null
  | ProviderInteractiveResponse[]
  | { [key: string]: ProviderInteractiveResponse | undefined };

export interface DecodedToolCallRequest {
  requestId: string | number;
  providerThreadId: string;
  /**
   * Non-empty BB turn id when known. Use null as the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  callId: string;
  tool: string;
  arguments?: unknown;
  threadId?: string;
}

export interface DecodedInteractiveRequest {
  requestId: string | number;
  method: string;
  providerThreadId: string;
  /**
   * Non-empty BB turn id when known. Use null as the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  payload: PendingInteractionPayload;
  threadId?: string;
}

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
  | { type: "model/list" }
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
      clientRequestId: ClientTurnRequestId;
      options: ProviderExecutionContext;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string;
      expectedTurnId: string;
      input: PromptInput[];
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

export interface PreparedProviderCommandDispatch {
  rollback(): void;
}

export function noPreparedProviderCommandDispatch(
  _command: TurnStartAdapterCommand,
): null {
  return null;
}

// ---------------------------------------------------------------------------
// ProviderAdapter — internal extension contract
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[]; env?: Record<string, string> };

  buildCommandPlan(command: AdapterCommand): ProviderCommandPlan;
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

export interface BuildInteractiveResponseArgs {
  request: DecodedInteractiveRequest;
  resolution: PendingInteractionResolution;
}
