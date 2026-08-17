/**
 * The stateful Codex event-translation pipeline.
 *
 * `createCodexEventTranslator` holds every per-connection translation closure:
 * raw shell-output recovery, delegation/subagent correlation, accepted-user-
 * message correlation, and workspace-write git-root staging. Events leave in
 * Codex-native id space (Codex turn/item ids, Codex thread ids in
 * threadId/providerThreadId); the bridge stamps bridge-minted ids on top.
 */

import {
  getThreadEventScopeTurnId,
  requireThreadEventScopeTurnId,
  turnScope,
  type ClientTurnRequestId,
  type ThreadEvent,
  type ThreadEventItem,
  type ThreadEventItemStatus,
  extractResultText,
  type JsonRpcMessage,
  type PreparedProviderCommandDispatch,
  type ProviderPostInitializeRequest,
  type ProviderRuntimeEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  applyCodexRateLimitUpdate,
  createCodexEventTranslationState,
  translateCodexEvent,
} from "./event-translation.js";
import {
  codexBridgeEnvelopeSchema,
  codexRateLimitReadResponseSchema,
  codexRawResponseItemCompletedParamsSchema,
  codexSubAgentActivityItemSchema,
  codexThreadClosedParamsSchema,
  type CodexSubAgentActivityItem,
} from "./schemas.js";
import {
  buildCodexConfig,
  gitWritableRootsForWorkspace,
  shouldCaptureWorkspaceWriteGitRoots,
  toCodexThreadPermissionSettings,
  type CodexSessionOptions,
  type CodexThreadPermissionSettings,
} from "./session-params.js";
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";

// Raw shell output recovery is a two-phase flow:
// 1. `rawResponseItem/completed` for shell `function_call` and
//    `function_call_output` events is consumed into per-thread state keyed by
//    the provider's `call_id`.
// 2. The later normalized `item/completed` commandExecution consumes that
//    stored state to repair the authoritative final output.
const CODEX_SHELL_TOOL_NAMES = new Set(["exec_command", "Bash", "bash"]);
const CODEX_DELEGATION_TOOL_NAMES = new Set(["spawnAgent", "resumeAgent"]);
const TOOL_OUTPUT_MARKER_LINE = "Output:";
const TOOL_OUTPUT_METADATA_PREFIXES = [
  "Chunk ID:",
  "Wall time:",
  "Process exited with code ",
  "Original token count:",
];
// TODO(codex): Delete this compatibility shim once app-server exposes
// structured stdout/stderr for shell tools. rawResponseItem/completed currently
// carries UI-formatted text, so recovery must stay conservative and avoid
// persisting wrapper metadata when the framing shape is ambiguous.

interface CodexRecoveredCommandOutput {
  kind: "recovered";
  output: string;
}

interface CodexEmptyCommandOutput {
  kind: "empty";
}

interface CodexUnparseableCommandOutput {
  kind: "unparseable";
}

type CodexCapturedCommandOutput =
  | CodexRecoveredCommandOutput
  | CodexEmptyCommandOutput;
type CodexParsedCommandOutput =
  | CodexCapturedCommandOutput
  | CodexUnparseableCommandOutput;

interface CodexRawCommandOutputState {
  capturedCommandOutputByCallId: Map<string, CodexCapturedCommandOutput>;
  pendingCompletedEventByCallId: Map<string, ThreadEvent>;
  shellToolCallIds: Set<string>;
}

interface CodexDelegationToolCall {
  callId: string;
  receiverThreadIds: string[];
  senderThreadId?: string;
}

interface CodexPendingDelegationTurnLink {
  callId: string;
  parentTurnId: string;
}

function collectStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function getCodexDelegationToolCall(
  event: ThreadEvent,
): CodexDelegationToolCall | null {
  if (
    (event.type !== "item/started" && event.type !== "item/completed") ||
    event.item.type !== "toolCall" ||
    !CODEX_DELEGATION_TOOL_NAMES.has(event.item.tool)
  ) {
    return null;
  }

  return {
    callId: event.item.id,
    receiverThreadIds: collectStringArray(
      event.item.arguments?.receiverThreadIds,
    ),
    senderThreadId:
      typeof event.item.arguments?.senderThreadId === "string" &&
      event.item.arguments.senderThreadId.length > 0
        ? event.item.arguments.senderThreadId
        : undefined,
  };
}

function getCodexEventProviderThreadId(event: ThreadEvent): string | undefined {
  if (
    "providerThreadId" in event &&
    typeof event.providerThreadId === "string" &&
    event.providerThreadId.length > 0
  ) {
    return event.providerThreadId;
  }
  return undefined;
}

function getCodexEventParentToolCallId(event: ThreadEvent): string | undefined {
  switch (event.type) {
    case "item/started":
    case "item/completed":
      return event.item.parentToolCallId;
    case "turn/started":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
    case "provider/unhandled":
      return event.parentToolCallId;
    default:
      return undefined;
  }
}

function withCodexParentToolCallId(
  event: ThreadEvent,
  parentToolCallId: string,
): ThreadEvent {
  if (getCodexEventParentToolCallId(event)) {
    return event;
  }

  switch (event.type) {
    case "turn/started":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
    case "provider/unhandled":
      return { ...event, parentToolCallId };
    case "item/started":
    case "item/completed":
      return {
        ...event,
        item: { ...event.item, parentToolCallId },
      };
    default:
      return event;
  }
}

function toCodexRawNotification(
  event: ProviderRuntimeEvent,
  expectedMethod?: string,
): JsonRpcMessage | null {
  const rawMethod = typeof event.method === "string" ? event.method : undefined;
  if (expectedMethod && rawMethod !== expectedMethod) {
    return null;
  }
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return null;
  }
  return {
    jsonrpc: "2.0",
    method: envelope.data.method,
    ...(envelope.data.params ? { params: envelope.data.params } : {}),
  };
}

function normalizeCommandOutputNewlines(output: string): string {
  return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

interface ParsedCodexOutputLine {
  line: string;
  nextIndex: number;
}

function readCodexOutputLine(
  text: string,
  startIndex: number,
): ParsedCodexOutputLine {
  const nextNewlineIndex = text.indexOf("\n", startIndex);
  if (nextNewlineIndex === -1) {
    return {
      line: text.slice(startIndex),
      nextIndex: text.length,
    };
  }
  return {
    line: text.slice(startIndex, nextNewlineIndex),
    nextIndex: nextNewlineIndex + 1,
  };
}

function isCodexToolOutputMetadataLine(line: string): boolean {
  return TOOL_OUTPUT_METADATA_PREFIXES.some((prefix) =>
    line.startsWith(prefix),
  );
}

function toCapturedCodexCommandOutput(
  output: string,
): CodexCapturedCommandOutput {
  return output.length === 0
    ? { kind: "empty" }
    : { kind: "recovered", output };
}

function findCodexOutputMarkerNextIndex(
  text: string,
  startIndex: number,
): number | null {
  let cursor = startIndex;
  while (cursor <= text.length) {
    const { line, nextIndex } = readCodexOutputLine(text, cursor);
    if (line === TOOL_OUTPUT_MARKER_LINE) {
      return nextIndex;
    }
    if (nextIndex >= text.length) {
      return null;
    }
    cursor = nextIndex;
  }
  return null;
}

function extractRecoveredCommandOutput(
  rawToolOutput: unknown,
): CodexParsedCommandOutput {
  const text = normalizeCommandOutputNewlines(extractResultText(rawToolOutput));
  if (text.length === 0) {
    return { kind: "empty" };
  }

  const firstLine = readCodexOutputLine(text, 0);
  if (firstLine.line === TOOL_OUTPUT_MARKER_LINE) {
    return toCapturedCodexCommandOutput(text.slice(firstLine.nextIndex));
  }

  if (!isCodexToolOutputMetadataLine(firstLine.line)) {
    return toCapturedCodexCommandOutput(text);
  }

  let cursor = firstLine.nextIndex;
  let metadataLineCount = 1;
  while (cursor <= text.length) {
    const { line, nextIndex } = readCodexOutputLine(text, cursor);
    if (line === TOOL_OUTPUT_MARKER_LINE) {
      return toCapturedCodexCommandOutput(text.slice(nextIndex));
    }
    if (!isCodexToolOutputMetadataLine(line)) {
      return findCodexOutputMarkerNextIndex(text, cursor) === null
        ? toCapturedCodexCommandOutput(text)
        : { kind: "unparseable" };
    }
    metadataLineCount += 1;
    if (nextIndex >= text.length) {
      return metadataLineCount === 1
        ? toCapturedCodexCommandOutput(text)
        : { kind: "unparseable" };
    }
    cursor = nextIndex;
  }

  return { kind: "unparseable" };
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

interface CreateCodexEventTranslatorOptions {
  additionalWorkspaceWriteRoots: readonly string[];
}

/** Structural session-construction input the git-root staging reads. */
interface CodexSessionConstructionInput {
  threadId: string;
  cwd?: string;
  options: CodexSessionOptions;
}

interface RecordThreadGitWritableRootsArgs {
  threadId: string;
  writableRoots: readonly string[];
}

interface ActivateThreadGitWritableRootsArgs {
  providerThreadId: string;
  threadId: string;
}

interface ClearGitWritableRootsByBbThreadIdArgs {
  threadId: string;
}

interface ClearGitWritableRootsByProviderThreadIdArgs {
  providerThreadId: string;
}

interface PreparedWorkspaceWriteGitRoots {
  config: { [key in string]?: JsonValue } | undefined;
  permissionSettings: CodexThreadPermissionSettings;
}

interface PrepareWorkspaceWriteGitRootsArgs {
  command: CodexSessionConstructionInput;
}

export type CodexEventTranslator = ReturnType<
  typeof createCodexEventTranslator
>;

export function createCodexEventTranslator(
  options: CreateCodexEventTranslatorOptions,
) {
  const additionalWorkspaceWriteRoots = options.additionalWorkspaceWriteRoots;
  const eventTranslationState = createCodexEventTranslationState();
  const nativeTurnStartClientRequestIdsByProviderThreadId = new Map<
    string,
    ClientTurnRequestId[]
  >();
  const pendingWorkspaceWriteGitWritableRootsByThreadId = new Map<
    string,
    string[]
  >();
  const workspaceWriteGitWritableRootsByThreadId = new Map<string, string[]>();
  const bbThreadIdByProviderThreadId = new Map<string, string>();
  const rawCommandOutputStateByProviderThreadId = new Map<
    string,
    CodexRawCommandOutputState
  >();
  const delegationParentToolCallIdsByProviderThreadId = new Map<
    string,
    string
  >();
  const delegationParentToolCallIdsByTurnId = new Map<string, string>();
  const pendingDelegationTurnLinksByProviderThreadId = new Map<
    string,
    CodexPendingDelegationTurnLink[]
  >();
  const pendingDelegationCallIds = new Set<string>();
  const pendingDelegationProviderThreadIdByCallId = new Map<string, string>();
  const processedSubAgentInteractionIds = new Set<string>();
  const trackedSubAgentsByCallId = new Map<string, CodexTrackedSubAgent>();
  const trackedSubAgentCallIdsByAgentThreadId = new Map<string, string>();

  function stageThreadGitWritableRoots(
    args: RecordThreadGitWritableRootsArgs,
  ): void {
    pendingWorkspaceWriteGitWritableRootsByThreadId.set(args.threadId, [
      ...args.writableRoots,
    ]);
  }

  function activateThreadGitWritableRoots(
    args: ActivateThreadGitWritableRootsArgs,
  ): void {
    const writableRoots = pendingWorkspaceWriteGitWritableRootsByThreadId.get(
      args.threadId,
    );
    if (!writableRoots) {
      return;
    }
    pendingWorkspaceWriteGitWritableRootsByThreadId.delete(args.threadId);
    workspaceWriteGitWritableRootsByThreadId.set(args.threadId, [
      ...writableRoots,
    ]);
    bbThreadIdByProviderThreadId.set(args.providerThreadId, args.threadId);
  }

  function clearGitWritableRootsByBbThreadId(
    args: ClearGitWritableRootsByBbThreadIdArgs,
  ): void {
    pendingWorkspaceWriteGitWritableRootsByThreadId.delete(args.threadId);
    workspaceWriteGitWritableRootsByThreadId.delete(args.threadId);
    for (const [providerThreadId, threadId] of bbThreadIdByProviderThreadId) {
      if (threadId === args.threadId) {
        bbThreadIdByProviderThreadId.delete(providerThreadId);
      }
    }
  }

  function clearGitWritableRootsByProviderThreadId(
    args: ClearGitWritableRootsByProviderThreadIdArgs,
  ): void {
    const threadId = bbThreadIdByProviderThreadId.get(args.providerThreadId);
    bbThreadIdByProviderThreadId.delete(args.providerThreadId);
    if (!threadId) {
      return;
    }
    clearGitWritableRootsByBbThreadId({ threadId });
  }

  function prepareWorkspaceWriteGitRoots(
    args: PrepareWorkspaceWriteGitRootsArgs,
  ): PreparedWorkspaceWriteGitRoots {
    const command = args.command;
    const captureWorkspaceWriteGitRoots = shouldCaptureWorkspaceWriteGitRoots(
      command.options,
    );
    const writableRoots = captureWorkspaceWriteGitRoots
      ? gitWritableRootsForWorkspace(command.cwd)
      : [];
    if (captureWorkspaceWriteGitRoots) {
      stageThreadGitWritableRoots({
        threadId: command.threadId,
        writableRoots,
      });
    } else {
      clearGitWritableRootsByBbThreadId({ threadId: command.threadId });
    }
    return {
      config: buildCodexConfig({
        additionalWorkspaceWriteRoots,
        gitWritableRoots: writableRoots,
        options: command.options,
        threadId: command.threadId,
      }),
      permissionSettings: toCodexThreadPermissionSettings(command.options),
    };
  }

  function getThreadGitWritableRoots(threadId: string): string[] {
    return workspaceWriteGitWritableRootsByThreadId.get(threadId) ?? [];
  }

  function getRawCommandOutputState(
    providerThreadId: string,
  ): CodexRawCommandOutputState {
    const existingState =
      rawCommandOutputStateByProviderThreadId.get(providerThreadId);
    if (existingState) {
      return existingState;
    }

    const nextState: CodexRawCommandOutputState = {
      capturedCommandOutputByCallId: new Map<
        string,
        CodexCapturedCommandOutput
      >(),
      pendingCompletedEventByCallId: new Map<string, ThreadEvent>(),
      shellToolCallIds: new Set<string>(),
    };
    rawCommandOutputStateByProviderThreadId.set(providerThreadId, nextState);
    return nextState;
  }

  function pruneRawCommandOutputState(providerThreadId: string): void {
    const state = rawCommandOutputStateByProviderThreadId.get(providerThreadId);
    if (!state) {
      return;
    }
    if (
      state.capturedCommandOutputByCallId.size === 0 &&
      state.pendingCompletedEventByCallId.size === 0 &&
      state.shellToolCallIds.size === 0
    ) {
      rawCommandOutputStateByProviderThreadId.delete(providerThreadId);
    }
  }

  function clearClosedThreadState(event: ProviderRuntimeEvent): void {
    const rawEvent = toCodexRawNotification(event, "thread/closed");
    if (!rawEvent) {
      return;
    }
    const paramsResult = codexThreadClosedParamsSchema.safeParse(
      rawEvent.params,
    );
    if (!paramsResult.success) {
      return;
    }
    clearExitedChildThreadState({
      providerThreadId: paramsResult.data.threadId,
    });
    clearGitWritableRootsByProviderThreadId({
      providerThreadId: paramsResult.data.threadId,
    });
  }

  /**
   * Drop the state that only describes a live `codex app-server` child: raw
   * command output in flight and the native-subagent tracking that answers
   * `hasOpenThreadWork`. Called when the thread closes and when the child dies
   * — otherwise a non-terminal tracked subagent keeps claiming open work for a
   * process that no longer exists, and the runtime never reaps the thread.
   */
  function clearExitedChildThreadState({
    providerThreadId,
  }: {
    providerThreadId: string;
  }): void {
    rawCommandOutputStateByProviderThreadId.delete(providerThreadId);
    clearCodexDelegationParentState(providerThreadId);
  }

  function clearCodexDelegationParentState(providerThreadId: string): void {
    delegationParentToolCallIdsByProviderThreadId.delete(providerThreadId);
    pendingDelegationTurnLinksByProviderThreadId.delete(providerThreadId);
    for (const [callId, tracked] of trackedSubAgentsByCallId) {
      if (
        tracked.parentProviderThreadId !== providerThreadId &&
        tracked.agentThreadId !== providerThreadId
      ) {
        continue;
      }
      clearTrackedSubAgentLinks(tracked);
      if (
        trackedSubAgentCallIdsByAgentThreadId.get(tracked.agentThreadId) ===
        tracked.callId
      ) {
        trackedSubAgentCallIdsByAgentThreadId.delete(tracked.agentThreadId);
      }
      trackedSubAgentsByCallId.delete(callId);
    }
  }

  function queueNativeTurnStartClientRequestId(args: {
    clientRequestId: ClientTurnRequestId | undefined;
    providerThreadId: string | undefined;
  }): PreparedProviderCommandDispatch | null {
    if (
      args.clientRequestId === undefined ||
      args.providerThreadId === undefined
    ) {
      return null;
    }
    const clientRequestId = args.clientRequestId;
    const providerThreadId = args.providerThreadId;
    nativeTurnStartClientRequestIdsByProviderThreadId.set(providerThreadId, [
      ...(nativeTurnStartClientRequestIdsByProviderThreadId.get(
        providerThreadId,
      ) ?? []),
      clientRequestId,
    ]);

    return {
      rollback: () => {
        removeNativeTurnStartClientRequestId({
          clientRequestId,
          providerThreadId,
        });
      },
      claim: () => {
        // Still queued means no turn/started (and no turn/completed, which
        // clears the thread's queue) has consumed this dispatch: the provider
        // accepted the prompt without opening a turn for it.
        const queued =
          nativeTurnStartClientRequestIdsByProviderThreadId.get(
            providerThreadId,
          ) ?? [];
        if (!queued.includes(clientRequestId)) {
          return false;
        }
        removeNativeTurnStartClientRequestId({
          clientRequestId,
          providerThreadId,
        });
        return true;
      },
    };
  }

  function removeNativeTurnStartClientRequestId(args: {
    clientRequestId: ClientTurnRequestId;
    providerThreadId: string;
  }): void {
    const sequences = nativeTurnStartClientRequestIdsByProviderThreadId.get(
      args.providerThreadId,
    );
    if (!sequences || sequences.length === 0) {
      return;
    }
    const nextSequences = [...sequences];
    const sequenceIndex = nextSequences.indexOf(args.clientRequestId);
    if (sequenceIndex === -1) {
      return;
    }
    nextSequences.splice(sequenceIndex, 1);
    if (nextSequences.length === 0) {
      nativeTurnStartClientRequestIdsByProviderThreadId.delete(
        args.providerThreadId,
      );
      return;
    }
    nativeTurnStartClientRequestIdsByProviderThreadId.set(
      args.providerThreadId,
      nextSequences,
    );
  }

  function shiftNativeTurnStartClientRequestId(
    providerThreadId: string,
  ): ClientTurnRequestId | undefined {
    const sequences =
      nativeTurnStartClientRequestIdsByProviderThreadId.get(providerThreadId);
    if (!sequences || sequences.length === 0) {
      return undefined;
    }
    const [clientRequestId, ...remainingSequences] = sequences;
    if (remainingSequences.length === 0) {
      nativeTurnStartClientRequestIdsByProviderThreadId.delete(
        providerThreadId,
      );
    } else {
      nativeTurnStartClientRequestIdsByProviderThreadId.set(
        providerThreadId,
        remainingSequences,
      );
    }
    return clientRequestId;
  }

  function attachAcceptedUserMessageCorrelation(
    event: ThreadEvent,
  ): ThreadEvent[] {
    if (event.type === "turn/completed") {
      if (event.providerThreadId !== null) {
        nativeTurnStartClientRequestIdsByProviderThreadId.delete(
          event.providerThreadId,
        );
      }
      return [event];
    }

    if (event.type === "turn/started") {
      const clientRequestId = shiftNativeTurnStartClientRequestId(
        event.providerThreadId,
      );
      if (clientRequestId === undefined) {
        return [event];
      }
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      return [
        event,
        {
          type: "turn/input/accepted",
          threadId: event.threadId,
          providerThreadId: event.providerThreadId,
          scope: turnScope(turnId),
          clientRequestId,
        },
      ];
    }

    if (
      (event.type !== "item/started" && event.type !== "item/completed") ||
      event.item.type !== "userMessage"
    ) {
      return [event];
    }

    return [];
  }

  function enqueuePendingDelegationTurnLink(args: {
    callId: string;
    parentTurnId: string | undefined;
    providerThreadId: string | undefined;
  }): void {
    if (!args.providerThreadId || !args.parentTurnId) {
      return;
    }
    if (pendingDelegationCallIds.has(args.callId)) {
      return;
    }

    const pendingLinks =
      pendingDelegationTurnLinksByProviderThreadId.get(args.providerThreadId) ??
      [];
    pendingLinks.push({
      callId: args.callId,
      parentTurnId: args.parentTurnId,
    });
    pendingDelegationTurnLinksByProviderThreadId.set(
      args.providerThreadId,
      pendingLinks,
    );
    pendingDelegationCallIds.add(args.callId);
    pendingDelegationProviderThreadIdByCallId.set(
      args.callId,
      args.providerThreadId,
    );
  }

  function removePendingDelegationCall(callId: string): void {
    pendingDelegationCallIds.delete(callId);
    const providerThreadId =
      pendingDelegationProviderThreadIdByCallId.get(callId);
    pendingDelegationProviderThreadIdByCallId.delete(callId);
    if (!providerThreadId) {
      return;
    }
    const pendingLinks =
      pendingDelegationTurnLinksByProviderThreadId.get(providerThreadId);
    if (!pendingLinks) {
      return;
    }
    const remainingLinks = pendingLinks.filter(
      (pendingLink) => pendingLink.callId !== callId,
    );
    if (remainingLinks.length === 0) {
      pendingDelegationTurnLinksByProviderThreadId.delete(providerThreadId);
    } else if (remainingLinks.length !== pendingLinks.length) {
      pendingDelegationTurnLinksByProviderThreadId.set(
        providerThreadId,
        remainingLinks,
      );
    }
  }

  function hasPendingNativeTurnStart(providerThreadId: string): boolean {
    return (
      (nativeTurnStartClientRequestIdsByProviderThreadId.get(providerThreadId)
        ?.length ?? 0) > 0
    );
  }

  function clearTrackedSubAgentLinks(tracked: CodexTrackedSubAgent): void {
    removePendingDelegationCall(tracked.callId);
    if (
      delegationParentToolCallIdsByProviderThreadId.get(
        tracked.agentThreadId,
      ) === tracked.callId
    ) {
      delegationParentToolCallIdsByProviderThreadId.delete(
        tracked.agentThreadId,
      );
    }
    for (const [
      turnId,
      parentToolCallId,
    ] of delegationParentToolCallIdsByTurnId) {
      if (parentToolCallId === tracked.callId) {
        delegationParentToolCallIdsByTurnId.delete(turnId);
      }
    }
  }

  function consumePendingDelegationTurnLink(args: {
    providerThreadId: string | undefined;
    turnId: string;
  }): string | undefined {
    if (!args.providerThreadId) {
      return undefined;
    }
    if (delegationParentToolCallIdsByTurnId.has(args.turnId)) {
      return delegationParentToolCallIdsByTurnId.get(args.turnId);
    }

    const pendingLinks = pendingDelegationTurnLinksByProviderThreadId.get(
      args.providerThreadId,
    );
    if (!pendingLinks || pendingLinks.length === 0) {
      return undefined;
    }

    while (pendingLinks.length > 0) {
      const pendingLink = pendingLinks.shift();
      if (!pendingLink || pendingLink.parentTurnId === args.turnId) {
        continue;
      }
      if (pendingLinks.length === 0) {
        pendingDelegationTurnLinksByProviderThreadId.delete(
          args.providerThreadId,
        );
      }
      delegationParentToolCallIdsByTurnId.set(args.turnId, pendingLink.callId);
      return pendingLink.callId;
    }

    pendingDelegationTurnLinksByProviderThreadId.delete(args.providerThreadId);
    return undefined;
  }

  function attachCodexDelegationParentLink(event: ThreadEvent): ThreadEvent {
    const providerThreadId = getCodexEventProviderThreadId(event);
    const turnId = getThreadEventScopeTurnId(event.scope);
    let parentToolCallId =
      getCodexEventParentToolCallId(event) ??
      (turnId ? delegationParentToolCallIdsByTurnId.get(turnId) : undefined);

    if (!parentToolCallId && event.type === "turn/started") {
      const startedTurnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      const mappedFromProviderThread = providerThreadId
        ? delegationParentToolCallIdsByProviderThreadId.get(providerThreadId)
        : undefined;
      if (mappedFromProviderThread) {
        parentToolCallId = mappedFromProviderThread;
        // A turn that matches an explicit agent-thread mapping must not also
        // consume a different agent's FIFO slot on the multiplexed root.
        removePendingDelegationCall(mappedFromProviderThread);
      } else if (
        !providerThreadId ||
        !hasPendingNativeTurnStart(providerThreadId)
      ) {
        parentToolCallId = consumePendingDelegationTurnLink({
          providerThreadId,
          turnId: startedTurnId,
        });
      }
    }

    if (!parentToolCallId && providerThreadId) {
      parentToolCallId =
        delegationParentToolCallIdsByProviderThreadId.get(providerThreadId);
    }

    if (event.type === "turn/started" && parentToolCallId) {
      delegationParentToolCallIdsByTurnId.set(
        requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        }),
        parentToolCallId,
      );
    }

    return parentToolCallId
      ? withCodexParentToolCallId(event, parentToolCallId)
      : event;
  }

  function observeCodexDelegationToolCall(event: ThreadEvent): void {
    const delegationToolCall = getCodexDelegationToolCall(event);
    if (!delegationToolCall) {
      return;
    }

    const providerThreadId = getCodexEventProviderThreadId(event);
    for (const receiverThreadId of delegationToolCall.receiverThreadIds) {
      if (
        receiverThreadId === providerThreadId ||
        receiverThreadId === delegationToolCall.senderThreadId
      ) {
        enqueuePendingDelegationTurnLink({
          callId: delegationToolCall.callId,
          parentTurnId: getThreadEventScopeTurnId(event.scope),
          providerThreadId,
        });
        continue;
      }
      delegationParentToolCallIdsByProviderThreadId.set(
        receiverThreadId,
        delegationToolCall.callId,
      );
    }

    if (delegationToolCall.receiverThreadIds.length === 0) {
      enqueuePendingDelegationTurnLink({
        callId: delegationToolCall.callId,
        parentTurnId: getThreadEventScopeTurnId(event.scope),
        providerThreadId,
      });
    }
  }

  function attachCodexDelegationParentLinks(
    events: ThreadEvent[],
  ): ThreadEvent[] {
    return events.map((event) => {
      const parentLinkedEvent = attachCodexDelegationParentLink(event);
      observeCodexDelegationToolCall(parentLinkedEvent);
      return parentLinkedEvent;
    });
  }

  function findTrackedSubAgentByAgentThreadId(
    agentThreadId: string,
  ): CodexTrackedSubAgent | undefined {
    // Keep this map after a child settles so resume does not scan every
    // historical agent. Thread close is the only cleanup.
    const callId = trackedSubAgentCallIdsByAgentThreadId.get(agentThreadId);
    if (!callId) {
      return undefined;
    }
    return trackedSubAgentsByCallId.get(callId);
  }

  function rearmTrackedSubAgent(tracked: CodexTrackedSubAgent): void {
    trackedSubAgentCallIdsByAgentThreadId.set(
      tracked.agentThreadId,
      tracked.callId,
    );
    if (tracked.agentThreadId !== tracked.parentProviderThreadId) {
      delegationParentToolCallIdsByProviderThreadId.set(
        tracked.agentThreadId,
        tracked.callId,
      );
    }
    enqueuePendingDelegationTurnLink({
      callId: tracked.callId,
      parentTurnId: tracked.parentTurnId,
      providerThreadId: tracked.parentProviderThreadId,
    });
  }

  function completeCodexTrackedSubAgent(args: {
    status: "completed" | "failed" | "interrupted";
    tracked: CodexTrackedSubAgent;
  }): ThreadEvent | null {
    const alreadyTerminal = args.tracked.terminal;
    args.tracked.terminal = true;
    clearTrackedSubAgentLinks(args.tracked);
    if (alreadyTerminal && args.tracked.pendingFollowups > 0) {
      args.tracked.pendingFollowups -= 1;
    }
    if (args.tracked.pendingFollowups > 0) {
      rearmTrackedSubAgent(args.tracked);
    }
    if (alreadyTerminal) {
      return null;
    }
    return buildCodexSubAgentCompletedEvent(args);
  }

  function translateCodexSubAgentActivity(
    event: ProviderRuntimeEvent,
  ): ThreadEvent[] | null {
    const activity = parseCodexSubAgentActivityEvent(event);
    if (!activity) {
      return null;
    }

    switch (activity.item.kind) {
      case "started": {
        if (trackedSubAgentsByCallId.has(activity.item.id)) {
          return [];
        }
        const tracked: CodexTrackedSubAgent = {
          agentPath: activity.item.agentPath,
          agentThreadId: activity.item.agentThreadId,
          callId: activity.item.id,
          parentProviderThreadId: activity.providerThreadId,
          parentTurnId: activity.turnId,
          pendingFollowups: 0,
          terminal: false,
        };
        trackedSubAgentsByCallId.set(tracked.callId, tracked);
        trackedSubAgentCallIdsByAgentThreadId.set(
          tracked.agentThreadId,
          tracked.callId,
        );

        const [startedEvent] = attachCodexDelegationParentLinks([
          buildCodexSubAgentStartedEvent(tracked),
        ]);
        if (
          startedEvent?.type === "item/started" &&
          startedEvent.item.type === "toolCall"
        ) {
          tracked.parentToolCallId = startedEvent.item.parentToolCallId;
        }
        // Codex currently multiplexes child turns onto the root provider
        // thread, even though the activity includes a distinct agent thread
        // id. Queue a FIFO fallback in addition to the explicit id mapping.
        enqueuePendingDelegationTurnLink({
          callId: tracked.callId,
          parentTurnId: tracked.parentTurnId,
          providerThreadId: tracked.parentProviderThreadId,
        });
        return startedEvent ? [startedEvent] : [];
      }
      case "interacted": {
        // Messaging an existing agent is activity within the original
        // delegation, not a new timeline row. A completed agent can receive
        // followup_task; re-arm the original parent so the next child turn
        // is not projected as a root turn.
        if (processedSubAgentInteractionIds.has(activity.item.id)) {
          return [];
        }
        processedSubAgentInteractionIds.add(activity.item.id);
        const tracked = findTrackedSubAgentByAgentThreadId(
          activity.item.agentThreadId,
        );
        if (tracked?.terminal) {
          tracked.pendingFollowups += 1;
          rearmTrackedSubAgent(tracked);
        }
        return [];
      }
      case "interrupted": {
        const callId = trackedSubAgentCallIdsByAgentThreadId.get(
          activity.item.agentThreadId,
        );
        const tracked = callId
          ? trackedSubAgentsByCallId.get(callId)
          : undefined;
        if (!tracked) {
          return [];
        }
        const completed = completeCodexTrackedSubAgent({
          tracked,
          status: "interrupted",
        });
        return completed ? [completed] : [];
      }
    }
  }

  function completeFinishedCodexSubAgentTurns(
    events: ThreadEvent[],
  ): ThreadEvent[] {
    const completedEvents: ThreadEvent[] = [];
    for (const event of events) {
      completedEvents.push(event);
      if (event.type !== "turn/completed") {
        continue;
      }
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      const callId = delegationParentToolCallIdsByTurnId.get(turnId);
      const tracked = callId ? trackedSubAgentsByCallId.get(callId) : undefined;
      if (!tracked) {
        continue;
      }
      const completed = completeCodexTrackedSubAgent({
        tracked,
        status: event.status,
      });
      if (completed) {
        completedEvents.push(completed);
      }
    }
    return completedEvents;
  }

  function consumeCodexRawResponseItem(
    event: ProviderRuntimeEvent,
  ): ThreadEvent[] | null {
    const rawEvent = toCodexRawNotification(event, "rawResponseItem/completed");
    if (!rawEvent) {
      return null;
    }

    const paramsResult = codexRawResponseItemCompletedParamsSchema.safeParse(
      rawEvent.params,
    );
    if (!paramsResult.success) {
      return [];
    }

    const { threadId: providerThreadId, item } = paramsResult.data;

    if (item.type === "function_call") {
      if (!CODEX_SHELL_TOOL_NAMES.has(item.name)) {
        return [];
      }
      getRawCommandOutputState(providerThreadId).shellToolCallIds.add(
        item.call_id,
      );
      return [];
    }

    if (item.type === "function_call_output") {
      const rawCommandOutputState =
        rawCommandOutputStateByProviderThreadId.get(providerThreadId);
      if (!rawCommandOutputState) {
        return [];
      }
      if (!rawCommandOutputState.shellToolCallIds.has(item.call_id)) {
        pruneRawCommandOutputState(providerThreadId);
        return [];
      }

      const recoveredOutput = extractRecoveredCommandOutput(item.output);
      if (recoveredOutput.kind !== "unparseable") {
        rawCommandOutputState.capturedCommandOutputByCallId.set(
          item.call_id,
          recoveredOutput,
        );
      } else {
        rawCommandOutputState.shellToolCallIds.delete(item.call_id);
      }
      const pendingCompletedEvent =
        rawCommandOutputState.pendingCompletedEventByCallId.get(item.call_id);
      if (pendingCompletedEvent) {
        rawCommandOutputState.pendingCompletedEventByCallId.delete(
          item.call_id,
        );
        const capturedOutput = consumeCapturedCommandOutput({
          commandExecutionId: item.call_id,
          providerThreadId,
        });
        return [
          repairCompletedCommandOutput(pendingCompletedEvent, capturedOutput),
        ];
      }
      pruneRawCommandOutputState(providerThreadId);
      return [];
    }

    if (item.type === "local_shell_call") {
      // TODO(codex): The checked-in live raw fixture currently shows shell
      // execution as function_call(exec_command) + function_call_output. If
      // app-server starts emitting local_shell_call with recoverable output,
      // extend this repair path with a real captured fixture first.
      return [];
    }

    if (
      item.type === "custom_tool_call" ||
      item.type === "custom_tool_call_output"
    ) {
      // TODO(codex): Keep this explicit so shell recovery does not silently
      // assume custom_tool_call traffic is equivalent to exec_command.
      return [];
    }

    return [];
  }

  function reconcileRawCommandOutputLifecycle(
    events: ThreadEvent[],
  ): ThreadEvent[] {
    const reconciledEvents: ThreadEvent[] = [];
    for (const event of events) {
      if (event.type === "turn/completed") {
        if (event.providerThreadId !== null) {
          const state = rawCommandOutputStateByProviderThreadId.get(
            event.providerThreadId,
          );
          if (state) {
            reconciledEvents.push(
              ...state.pendingCompletedEventByCallId.values(),
            );
          }
          rawCommandOutputStateByProviderThreadId.delete(
            event.providerThreadId,
          );
        }
      }
      reconciledEvents.push(event);
    }
    return reconciledEvents;
  }

  function consumeCapturedCommandOutput(args: {
    commandExecutionId: string;
    providerThreadId: string;
  }): CodexCapturedCommandOutput | undefined {
    const rawCommandOutputState = rawCommandOutputStateByProviderThreadId.get(
      args.providerThreadId,
    );
    if (!rawCommandOutputState) {
      return undefined;
    }

    const capturedOutput =
      rawCommandOutputState.capturedCommandOutputByCallId.get(
        args.commandExecutionId,
      );
    rawCommandOutputState.shellToolCallIds.delete(args.commandExecutionId);
    rawCommandOutputState.capturedCommandOutputByCallId.delete(
      args.commandExecutionId,
    );
    pruneRawCommandOutputState(args.providerThreadId);
    return capturedOutput;
  }

  function repairCompletedCommandOutput(
    event: ThreadEvent,
    capturedOutput: CodexCapturedCommandOutput | undefined,
  ): ThreadEvent {
    if (
      capturedOutput === undefined ||
      event.type !== "item/completed" ||
      event.item.type !== "commandExecution"
    ) {
      return event;
    }

    if (
      capturedOutput.kind === "recovered" &&
      event.item.aggregatedOutput === capturedOutput.output
    ) {
      return event;
    }

    if (capturedOutput.kind === "empty") {
      if (event.item.aggregatedOutput === undefined) {
        return event;
      }
      const { aggregatedOutput: _aggregatedOutput, ...itemWithoutOutput } =
        event.item;
      return {
        ...event,
        item: itemWithoutOutput,
      };
    }

    return {
      ...event,
      item: {
        ...event.item,
        aggregatedOutput: capturedOutput.output,
      },
    };
  }

  function applyRecoveredCommandOutput(events: ThreadEvent[]): ThreadEvent[] {
    const repairedEvents: ThreadEvent[] = [];
    for (const event of events) {
      if (
        event.type !== "item/completed" ||
        event.item.type !== "commandExecution"
      ) {
        repairedEvents.push(event);
        continue;
      }

      const rawCommandOutputState = rawCommandOutputStateByProviderThreadId.get(
        event.providerThreadId,
      );
      if (
        !rawCommandOutputState?.capturedCommandOutputByCallId.has(event.item.id)
      ) {
        if (rawCommandOutputState?.shellToolCallIds.has(event.item.id)) {
          rawCommandOutputState.pendingCompletedEventByCallId.set(
            event.item.id,
            event,
          );
          continue;
        }
        repairedEvents.push(event);
        continue;
      }
      const capturedOutput = consumeCapturedCommandOutput({
        commandExecutionId: event.item.id,
        providerThreadId: event.providerThreadId,
      });
      repairedEvents.push(repairCompletedCommandOutput(event, capturedOutput));
    }
    return repairedEvents;
  }

  function buildPostInitializeRequests(): readonly ProviderPostInitializeRequest[] {
    return [
      {
        plan: {
          kind: "request" as const,
          method: "account/rateLimits/read",
        },
        required: false,
        onResult(result: unknown) {
          const response = codexRateLimitReadResponseSchema.parse(result);
          applyCodexRateLimitUpdate(eventTranslationState, response.rateLimits);
        },
      },
    ];
  }

  function translateEvent(event: ProviderRuntimeEvent): ThreadEvent[] {
    clearClosedThreadState(event);
    const rawResponseEvents = consumeCodexRawResponseItem(event);
    if (rawResponseEvents !== null) {
      return rawResponseEvents;
    }

    const subAgentActivityEvents = translateCodexSubAgentActivity(event);
    if (subAgentActivityEvents !== null) {
      return reconcileRawCommandOutputLifecycle(
        applyRecoveredCommandOutput(subAgentActivityEvents),
      );
    }

    const parentLinkedEvents = attachCodexDelegationParentLinks(
      translateCodexEvent(event, eventTranslationState),
    );
    const translatedEvents = parentLinkedEvents.flatMap(
      attachAcceptedUserMessageCorrelation,
    );
    const completedSubAgentEvents =
      completeFinishedCodexSubAgentTurns(translatedEvents);
    return reconcileRawCommandOutputLifecycle(
      applyRecoveredCommandOutput(completedSubAgentEvents),
    );
  }

  // Codex reports native subagents as toolCall items rather than as BB
  // background tasks, so the shared background-work state cannot see them.
  // Report them here; a session release must not stop the parent process
  // while a child agent still runs or still owes a followup turn.
  function hasOpenThreadWork({
    providerThreadId,
  }: {
    providerThreadId: string;
  }): boolean {
    for (const tracked of trackedSubAgentsByCallId.values()) {
      if (tracked.parentProviderThreadId !== providerThreadId) {
        continue;
      }
      if (!tracked.terminal || tracked.pendingFollowups > 0) {
        return true;
      }
    }
    return false;
  }

  return {
    activateThreadGitWritableRoots,
    buildPostInitializeRequests,
    clearExitedChildThreadState,
    getThreadGitWritableRoots,
    hasOpenThreadWork,
    prepareTurnStart: queueNativeTurnStartClientRequestId,
    prepareWorkspaceWriteGitRoots,
    translateEvent,
  };
}

// ---------------------------------------------------------------------------
// Native sub-agent activity
//
// Codex reports its own sub-agents as `subAgentActivity` items; the tracking
// state lives entirely in this module's closures, so the mapping lives here
// too.
// ---------------------------------------------------------------------------

interface CodexSubAgentActivityEvent {
  item: CodexSubAgentActivityItem;
  providerThreadId: string;
  turnId: string;
}

interface CodexTrackedSubAgent {
  agentPath: string;
  agentThreadId: string;
  callId: string;
  parentProviderThreadId: string;
  parentToolCallId?: string;
  parentTurnId: string;
  pendingFollowups: number;
  terminal: boolean;
}

function parseCodexSubAgentActivityEvent(
  event: ProviderRuntimeEvent,
): CodexSubAgentActivityEvent | null {
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success || envelope.data.method !== "item/completed") {
    return null;
  }

  const params = envelope.data.params;
  if (!params) {
    return null;
  }
  const item = codexSubAgentActivityItemSchema.safeParse(params.item);
  if (
    !item.success ||
    typeof params.threadId !== "string" ||
    typeof params.turnId !== "string"
  ) {
    return null;
  }

  return {
    item: item.data,
    providerThreadId: params.threadId,
    turnId: params.turnId,
  };
}

function buildSubAgentToolCallItem(
  tracked: CodexTrackedSubAgent,
  status: ThreadEventItemStatus,
): Extract<ThreadEventItem, { type: "toolCall" }> {
  return {
    type: "toolCall",
    id: tracked.callId,
    tool: "spawnAgent",
    arguments: {
      senderThreadId: tracked.parentProviderThreadId,
      receiverThreadIds: [tracked.agentThreadId],
      description: tracked.agentPath,
    },
    status,
    ...(tracked.parentToolCallId
      ? { parentToolCallId: tracked.parentToolCallId }
      : {}),
    ...(status === "pending"
      ? {}
      : {
          result: {
            agentPath: tracked.agentPath,
            agentThreadId: tracked.agentThreadId,
          },
        }),
  };
}

function buildCodexSubAgentStartedEvent(
  tracked: CodexTrackedSubAgent,
): ThreadEvent {
  return {
    type: "item/started",
    threadId: tracked.parentProviderThreadId,
    providerThreadId: tracked.parentProviderThreadId,
    scope: turnScope(tracked.parentTurnId),
    item: buildSubAgentToolCallItem(tracked, "pending"),
  };
}

function buildCodexSubAgentCompletedEvent(args: {
  status: Exclude<ThreadEventItemStatus, "pending">;
  tracked: CodexTrackedSubAgent;
}): ThreadEvent {
  return {
    type: "item/completed",
    threadId: args.tracked.parentProviderThreadId,
    providerThreadId: args.tracked.parentProviderThreadId,
    scope: turnScope(args.tracked.parentTurnId),
    item: buildSubAgentToolCallItem(args.tracked, args.status),
  };
}
