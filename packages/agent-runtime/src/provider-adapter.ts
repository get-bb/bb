/**
 * The runtime → bridge-adapter command vocabulary: what the runtime asks the
 * bridge-protocol adapter to build a request for, and the execution context
 * every session/turn command carries. The adapter contract itself is
 * `BridgeProtocolAdapter` in bridge-protocol-adapter.ts — every provider
 * speaks the Provider Bridge Protocol, so there is one adapter and no
 * provider-specific implementations behind an interface.
 */
import type {
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  JsonObject,
  PromptInput,
  PromptMode,
  ReasoningLevel,
  RuntimePermissionPolicy,
  RuntimeThreadExecutionOptions,
  ServiceTier,
} from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import type {
  AgentRuntimeBridgeLaunch,
  AgentRuntimeSkillRoot,
} from "./types.js";

export interface ProviderAcceptedCommandTranslationArgs {
  command: AdapterCommand;
  providerThreadId?: string;
}

/**
 * What the runtime knows when it builds the adapter for a provider process:
 * the plugin's bridge launch (artifact or daemon-bundled bridge), the ACP
 * launch spec for the ACP tier, host-local write roots, and the node/bundle
 * locations a packaged daemon runs bridges from.
 */
export interface CreateBridgeAdapterOptions {
  additionalWorkspaceWriteRoots: readonly string[];
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  /**
   * A plugin-delivered bridge artifact resolved to a verified local path by
   * the host daemon, or the id of a bridge the daemon bundles (pi).
   */
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  bridgeBundleDir?: string;
  bridgeNodeEnv?: Record<string, string>;
  bridgeNodeExecutablePath?: string;
}

// ---------------------------------------------------------------------------
// AdapterCommand — what the runtime asks the adapter to build
// ---------------------------------------------------------------------------

export type ProviderExecutionContext = {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  /** BB prompt mode, present only when the prompt entered one. */
  promptMode?: PromptMode;
  /**
   * Plugin-derived, provider-scoped options from the server. Opaque here;
   * merged over the bridge's static options onto the wire `providerOptions`.
   */
  providerOptions: JsonObject;
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
  | { type: "provider/health"; cwd?: string }
  | { type: "provider/usage"; cwd?: string }
  | {
      type: "provider/installation/status";
      cwd?: string;
      requirement?: "thread_rewind";
    }
  | {
      type: "provider/installation/run";
      action: "install" | "update";
      cwd?: string;
    }
  | {
      type: "thread/start";
      threadId: string;
      cwd: string;
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

export type ProviderExecutionSettingsChange = "unchanged" | "live" | "session";

export interface ClassifyProviderExecutionSettingsChangeArgs {
  current: RuntimeThreadExecutionOptions;
  next: RuntimeThreadExecutionOptions;
}
