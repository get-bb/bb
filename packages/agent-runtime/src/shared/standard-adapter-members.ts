import type {
  ProviderCapabilities,
  RuntimeThreadExecutionOptions,
  ThreadEvent,
} from "@bb/domain";
import type {
  AdapterCommand,
  ClassifyProviderExecutionSettingsChangeArgs,
  PreparedProviderCommandDispatch,
  ProviderAcceptedCommandTranslationArgs,
  ProviderCommandPlan,
  ProviderExecutionSettingsChange,
  ProviderTranslationContext,
  TurnStartAdapterCommand,
} from "../provider-adapter.js";
import { noPreparedProviderCommandDispatch } from "../provider-adapter.js";
import type {
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "../runtime-json-rpc.js";
import {
  buildAcceptedUserMessageEvent,
  queueAcceptedUserMessage,
  type AcceptedUserMessageState,
} from "./accepted-user-messages.js";
import {
  decodeNativeProviderToolCallRequest,
  decodeNormalizedProviderToolCallRequest,
} from "./provider-tool-call-contract.js";
import {
  parseAvailableModelList,
  type ParsedModelListResult,
} from "./available-models.js";
import type {
  ProviderTurnState,
  ProviderTurnStateRegistry,
} from "./turn-state.js";

type NonInitializeAdapterCommand = Exclude<
  AdapterCommand,
  { type: "initialize" }
>;
type SessionReplaceCommand = Extract<
  AdapterCommand,
  {
    type: "thread/start" | "thread/resume" | "thread/fork" | "thread/stop";
  }
>;

interface StandardAdapterBaseOptions {
  approvalRequestPolicy: "provider" | "runtime";
  buildProviderCommandPlan: (
    command: NonInitializeAdapterCommand,
  ) => ProviderCommandPlan | null;
  capabilities: ProviderCapabilities;
  classifyExecutionSettingsChange: (
    args: ClassifyProviderExecutionSettingsChangeArgs,
  ) => ProviderExecutionSettingsChange;
  displayName: string;
  id: string;
  initializeParams: object;
  normalizeExecutionOptions?: (
    options: RuntimeThreadExecutionOptions,
  ) => RuntimeThreadExecutionOptions;
  process: { command: string; args: string[]; env?: Record<string, string> };
  translateEvent: (
    event: ProviderRuntimeEvent,
    context?: ProviderTranslationContext,
  ) => ThreadEvent[];
}

interface NativeStandardAdapterOptions extends StandardAdapterBaseOptions {
  codec: "native";
  onSessionReplace?: (args: {
    command: Exclude<SessionReplaceCommand, { type: "thread/stop" }>;
    providerThreadId?: string;
  }) => ThreadEvent[];
  parseModelListResult: (result: unknown) => ParsedModelListResult;
  prepareTurnStart: (
    command: TurnStartAdapterCommand,
  ) => PreparedProviderCommandDispatch | null;
}

interface NormalizedStandardAdapterOptions<
  TState extends ProviderTurnState & AcceptedUserMessageState,
> extends StandardAdapterBaseOptions {
  codec: "normalized";
  onSessionReplace?: (args: {
    command: SessionReplaceCommand;
    state: TState;
  }) => ThreadEvent[];
  turnState: ProviderTurnStateRegistry<TState>;
}

function decodeToolCallRequest(
  codec: "native" | "normalized",
  request: ProviderInboundRequest,
) {
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    return null;
  }
  const decode =
    codec === "native"
      ? decodeNativeProviderToolCallRequest
      : decodeNormalizedProviderToolCallRequest;
  return decode(request.id, request.method, request.params);
}

function buildUnsupportedCommandPlan(args: {
  command: NonInitializeAdapterCommand;
  providerId: string;
}): ProviderCommandPlan {
  switch (args.command.type) {
    case "thread/goal/clear":
      return { kind: "noop", reason: "goals unsupported" };
    case "thread/name/set":
      return { kind: "noop", reason: "rename unsupported" };
    case "thread/archive":
    case "thread/unarchive":
      return { kind: "noop", reason: "archive unsupported" };
    case "thread/fork":
      throw new Error(
        `Provider "${args.providerId}" does not support forking threads.`,
      );
    default:
      throw new Error(
        `Provider "${args.providerId}" has no plan for ${args.command.type}.`,
      );
  }
}

function translateNativeAcceptedCommand(
  options: NativeStandardAdapterOptions,
  args: ProviderAcceptedCommandTranslationArgs,
): ThreadEvent[] {
  if (
    args.command.type === "thread/start" ||
    args.command.type === "thread/resume" ||
    args.command.type === "thread/fork"
  ) {
    return (
      options.onSessionReplace?.({
        command: args.command,
        ...(args.providerThreadId
          ? { providerThreadId: args.providerThreadId }
          : {}),
      }) ?? []
    );
  }
  if (args.command.type !== "turn/steer") {
    return [];
  }
  return buildAcceptedUserMessageEvent({
    clientRequestId: args.command.clientRequestId,
    providerThreadId: args.command.providerThreadId,
    threadId: args.command.threadId,
    turnId: args.command.expectedTurnId,
  });
}

function translateNormalizedAcceptedCommand<
  TState extends ProviderTurnState & AcceptedUserMessageState,
>(
  options: NormalizedStandardAdapterOptions<TState>,
  args: ProviderAcceptedCommandTranslationArgs,
): ThreadEvent[] {
  const command = args.command;
  if (
    command.type === "thread/start" ||
    command.type === "thread/resume" ||
    command.type === "thread/stop" ||
    (options.capabilities.supportsFork && command.type === "thread/fork")
  ) {
    const state = options.turnState.getOrCreate({ threadId: command.threadId });
    state.pendingAcceptedUserMessages = [];
    return options.onSessionReplace?.({ command, state }) ?? [];
  }
  if (command.type === "turn/start") {
    const state = options.turnState.getOrCreate({ threadId: command.threadId });
    if (state.currentTurnId !== undefined) {
      return buildAcceptedUserMessageEvent({
        clientRequestId: command.clientRequestId,
        providerThreadId: command.providerThreadId,
        threadId: command.threadId,
        turnId: state.currentTurnId,
      });
    }
    queueAcceptedUserMessage({
      clientRequestId: command.clientRequestId,
      state,
    });
  }
  if (command.type === "turn/steer") {
    return buildAcceptedUserMessageEvent({
      clientRequestId: command.clientRequestId,
      providerThreadId: command.providerThreadId,
      threadId: command.threadId,
      turnId: command.expectedTurnId,
    });
  }
  return [];
}

export function createStandardAdapterMembers<
  TState extends ProviderTurnState & AcceptedUserMessageState,
>(
  options:
    | NativeStandardAdapterOptions
    | NormalizedStandardAdapterOptions<TState>,
) {
  return {
    id: options.id,
    displayName: options.displayName,
    capabilities: options.capabilities,
    approvalRequestPolicy: options.approvalRequestPolicy,
    classifyExecutionSettingsChange: options.classifyExecutionSettingsChange,
    ...(options.normalizeExecutionOptions
      ? { normalizeExecutionOptions: options.normalizeExecutionOptions }
      : {}),
    process: options.process,
    buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
      if (command.type === "initialize") {
        return {
          kind: "request",
          method: "initialize",
          params: options.initializeParams,
        };
      }
      return (
        options.buildProviderCommandPlan(command) ??
        buildUnsupportedCommandPlan({
          command,
          providerId: options.id,
        })
      );
    },
    prepareTurnStart:
      options.codec === "native"
        ? options.prepareTurnStart
        : noPreparedProviderCommandDispatch,
    translateEvent: options.translateEvent,
    translateAcceptedCommand(args: ProviderAcceptedCommandTranslationArgs) {
      return options.codec === "native"
        ? translateNativeAcceptedCommand(options, args)
        : translateNormalizedAcceptedCommand(options, args);
    },
    parseModelListResult:
      options.codec === "native"
        ? options.parseModelListResult
        : parseAvailableModelList,
    decodeToolCallRequest: (request: ProviderInboundRequest) =>
      decodeToolCallRequest(options.codec, request),
  };
}
