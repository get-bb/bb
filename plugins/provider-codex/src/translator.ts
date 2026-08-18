/**
 * The stateful Codex event-translation pipeline (narrow-grammar deltas).
 *
 * `createCodexEventTranslator` holds every per-connection translation closure:
 * raw shell-output recovery, delegation/subagent correlation, accepted-turn
 * correlation, and workspace-write git-root staging. Events leave as
 * `thread/delta` semantic deltas in Codex-native id space (codex turn ids as
 * `providerTurnId`, codex item ids as `key.providerItemId`); the runtime's
 * delta assembler mints the bb ids.
 */

import {
  type ClientTurnRequestId,
  type DeltaItemShape,
  type ThreadDelta,
  type ThreadEventItemStatus,
  extractResultText,
  type PreparedProviderCommandDispatch,
  type ProviderPostInitializeRequest,
  type ProviderRuntimeEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  applyCodexRateLimitUpdate,
  createCodexEventTranslationState,
  translateCodexEventToDeltas,
} from "./delta-translation.js";
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
// 2. The later `item.close` command delta consumes that stored state to
//    repair the authoritative final output.
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

/** A close delta narrowed to a command shape (raw output repair target). */
type CommandCloseDelta = Extract<ThreadDelta, { kind: "item.close" }> & {
  item: Extract<DeltaItemShape, { type: "command" }>;
};

interface CodexRawCommandOutputState {
  capturedCommandOutputByCallId: Map<string, CodexCapturedCommandOutput>;
  pendingCloseDeltaByCallId: Map<string, CommandCloseDelta>;
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

/** The delegation arguments the synthetic/native spawn calls carry. */
const codexDelegationArgsSchema = z
  .object({
    receiverThreadIds: z.array(z.string()).optional(),
    senderThreadId: z.string().optional(),
  })
  .passthrough();

function collectStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function getCodexDelegationToolCall(
  delta: ThreadDelta,
): CodexDelegationToolCall | null {
  if (
    (delta.kind !== "item.open" && delta.kind !== "item.close") ||
    delta.item.type !== "tool" ||
    !CODEX_DELEGATION_TOOL_NAMES.has(delta.item.tool) ||
    delta.key.providerItemId === undefined
  ) {
    return null;
  }
  const args = codexDelegationArgsSchema.safeParse(delta.item.args);

  return {
    callId: delta.key.providerItemId,
    receiverThreadIds: collectStringArray(
      args.success ? args.data.receiverThreadIds : undefined,
    ),
    senderThreadId:
      args.success &&
      typeof args.data.senderThreadId === "string" &&
      args.data.senderThreadId.length > 0
        ? args.data.senderThreadId
        : undefined,
  };
}

/** The vouched provider turn id a delta is scoped to, when it names one. */
function getDeltaProviderTurnId(delta: ThreadDelta): string | undefined {
  return "providerTurnId" in delta ? delta.providerTurnId : undefined;
}

function getDeltaParentRef(delta: ThreadDelta): string | undefined {
  switch (delta.kind) {
    case "turn.open":
      return delta.parentRef;
    case "item.open":
    case "item.close":
    case "item.progress":
    case "item.textDelta":
    case "item.outputDelta":
      return delta.key.parentRef;
    case "unhandled":
      return delta.parentRef;
    default:
      return undefined;
  }
}

function withDeltaParentRef(
  delta: ThreadDelta,
  parentRef: string,
): ThreadDelta {
  if (getDeltaParentRef(delta)) {
    return delta;
  }

  switch (delta.kind) {
    case "turn.open":
      return { ...delta, parentRef };
    case "item.open":
    case "item.close":
    case "item.progress":
    case "item.textDelta":
    case "item.outputDelta":
      return { ...delta, key: { ...delta.key, parentRef } };
    case "unhandled":
      return { ...delta, parentRef };
    default:
      return delta;
  }
}

/**
 * The codex thread id a notification belongs to (`params.threadId`, or the
 * started thread's own id). Undefined for account-scoped traffic.
 */
const codexProviderThreadIdParamsSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    thread: z.object({ id: z.string().min(1) }).passthrough().optional(),
  })
  .passthrough();

function extractCodexProviderThreadId(
  event: ProviderRuntimeEvent,
): string | undefined {
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return undefined;
  }
  const params = codexProviderThreadIdParamsSchema.safeParse(
    envelope.data.params,
  );
  if (!params.success) {
    return undefined;
  }
  return params.data.threadId ?? params.data.thread?.id;
}

function toCodexRawNotification(
  event: ProviderRuntimeEvent,
  expectedMethod?: string,
): { method: string; params: unknown } | null {
  const rawMethod = typeof event.method === "string" ? event.method : undefined;
  if (expectedMethod && rawMethod !== expectedMethod) {
    return null;
  }
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return null;
  }
  return { method: envelope.data.method, params: envelope.data.params };
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
      pendingCloseDeltaByCallId: new Map<string, CommandCloseDelta>(),
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
      state.pendingCloseDeltaByCallId.size === 0 &&
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

  /**
   * Accepted-input correlation: the native `turn/started` that consumed a
   * queued dispatch is followed by an `input.accepted` against that vouched
   * turn; a turn boundary clears the thread's whole queue (codex answered the
   * turn, nothing queued can still be pending).
   */
  function attachAcceptedInputCorrelation(
    delta: ThreadDelta,
    providerThreadId: string | undefined,
  ): ThreadDelta[] {
    if (delta.kind === "turn.boundary") {
      if (providerThreadId !== undefined) {
        nativeTurnStartClientRequestIdsByProviderThreadId.delete(
          providerThreadId,
        );
      }
      return [delta];
    }

    if (
      delta.kind === "turn.open" &&
      delta.providerTurnId !== undefined &&
      providerThreadId !== undefined
    ) {
      const clientRequestId =
        shiftNativeTurnStartClientRequestId(providerThreadId);
      if (clientRequestId === undefined) {
        return [delta];
      }
      return [
        delta,
        {
          kind: "input.accepted",
          clientRequestId,
          providerTurnId: delta.providerTurnId,
        },
      ];
    }

    return [delta];
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

  function attachCodexDelegationParentLink(
    delta: ThreadDelta,
    providerThreadId: string | undefined,
  ): ThreadDelta {
    const turnId = getDeltaProviderTurnId(delta);
    let parentToolCallId =
      getDeltaParentRef(delta) ??
      (turnId ? delegationParentToolCallIdsByTurnId.get(turnId) : undefined);

    if (
      !parentToolCallId &&
      delta.kind === "turn.open" &&
      delta.providerTurnId !== undefined
    ) {
      const startedTurnId = delta.providerTurnId;
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

    if (
      delta.kind === "turn.open" &&
      delta.providerTurnId !== undefined &&
      parentToolCallId
    ) {
      delegationParentToolCallIdsByTurnId.set(
        delta.providerTurnId,
        parentToolCallId,
      );
    }

    return parentToolCallId
      ? withDeltaParentRef(delta, parentToolCallId)
      : delta;
  }

  function observeCodexDelegationToolCall(
    delta: ThreadDelta,
    providerThreadId: string | undefined,
  ): void {
    const delegationToolCall = getCodexDelegationToolCall(delta);
    if (!delegationToolCall) {
      return;
    }

    for (const receiverThreadId of delegationToolCall.receiverThreadIds) {
      if (
        receiverThreadId === providerThreadId ||
        receiverThreadId === delegationToolCall.senderThreadId
      ) {
        enqueuePendingDelegationTurnLink({
          callId: delegationToolCall.callId,
          parentTurnId: getDeltaProviderTurnId(delta),
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
        parentTurnId: getDeltaProviderTurnId(delta),
        providerThreadId,
      });
    }
  }

  function attachCodexDelegationParentLinks(
    deltas: ThreadDelta[],
    providerThreadId: string | undefined,
  ): ThreadDelta[] {
    return deltas.map((delta) => {
      const parentLinkedDelta = attachCodexDelegationParentLink(
        delta,
        providerThreadId,
      );
      observeCodexDelegationToolCall(parentLinkedDelta, providerThreadId);
      return parentLinkedDelta;
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
  }): ThreadDelta | null {
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
    return buildCodexSubAgentCloseDelta(args);
  }

  function translateCodexSubAgentActivity(
    event: ProviderRuntimeEvent,
  ): ThreadDelta[] | null {
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

        const [openDelta] = attachCodexDelegationParentLinks(
          [buildCodexSubAgentOpenDelta(tracked)],
          activity.providerThreadId,
        );
        if (openDelta?.kind === "item.open") {
          tracked.parentToolCallId = openDelta.key.parentRef;
        }
        // Codex currently multiplexes child turns onto the root provider
        // thread, even though the activity includes a distinct agent thread
        // id. Queue a FIFO fallback in addition to the explicit id mapping.
        enqueuePendingDelegationTurnLink({
          callId: tracked.callId,
          parentTurnId: tracked.parentTurnId,
          providerThreadId: tracked.parentProviderThreadId,
        });
        return openDelta ? [openDelta] : [];
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
    deltas: ThreadDelta[],
  ): ThreadDelta[] {
    const completedDeltas: ThreadDelta[] = [];
    for (const delta of deltas) {
      completedDeltas.push(delta);
      if (delta.kind !== "turn.boundary" || delta.providerTurnId === undefined) {
        continue;
      }
      const callId = delegationParentToolCallIdsByTurnId.get(
        delta.providerTurnId,
      );
      const tracked = callId ? trackedSubAgentsByCallId.get(callId) : undefined;
      if (!tracked) {
        continue;
      }
      const completed = completeCodexTrackedSubAgent({
        tracked,
        status: delta.status,
      });
      if (completed) {
        completedDeltas.push(completed);
      }
    }
    return completedDeltas;
  }

  function consumeCodexRawResponseItem(
    event: ProviderRuntimeEvent,
  ): ThreadDelta[] | null {
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
      const pendingCloseDelta =
        rawCommandOutputState.pendingCloseDeltaByCallId.get(item.call_id);
      if (pendingCloseDelta) {
        rawCommandOutputState.pendingCloseDeltaByCallId.delete(item.call_id);
        const capturedOutput = consumeCapturedCommandOutput({
          commandExecutionId: item.call_id,
          providerThreadId,
        });
        return [repairCommandCloseDelta(pendingCloseDelta, capturedOutput)];
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

  /**
   * Flush completed commands still held back for raw output before their
   * turn's boundary: the item must settle inside the turn it belongs to.
   */
  function reconcileRawCommandOutputLifecycle(
    deltas: ThreadDelta[],
    providerThreadId: string | undefined,
  ): ThreadDelta[] {
    const reconciledDeltas: ThreadDelta[] = [];
    for (const delta of deltas) {
      if (delta.kind === "turn.boundary" && providerThreadId !== undefined) {
        const state =
          rawCommandOutputStateByProviderThreadId.get(providerThreadId);
        if (state) {
          reconciledDeltas.push(...state.pendingCloseDeltaByCallId.values());
        }
        rawCommandOutputStateByProviderThreadId.delete(providerThreadId);
      }
      reconciledDeltas.push(delta);
    }
    return reconciledDeltas;
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

  function repairCommandCloseDelta(
    delta: CommandCloseDelta,
    capturedOutput: CodexCapturedCommandOutput | undefined,
  ): ThreadDelta {
    if (capturedOutput === undefined) {
      return delta;
    }

    if (
      capturedOutput.kind === "recovered" &&
      delta.item.aggregatedOutput === capturedOutput.output
    ) {
      return delta;
    }

    if (capturedOutput.kind === "empty") {
      if (delta.item.aggregatedOutput === undefined) {
        return delta;
      }
      const { aggregatedOutput: _aggregatedOutput, ...shapeWithoutOutput } =
        delta.item;
      return { ...delta, item: shapeWithoutOutput };
    }

    return {
      ...delta,
      item: { ...delta.item, aggregatedOutput: capturedOutput.output },
    };
  }

  function isCommandCloseDelta(delta: ThreadDelta): delta is CommandCloseDelta {
    return delta.kind === "item.close" && delta.item.type === "command";
  }

  function applyRecoveredCommandOutput(
    deltas: ThreadDelta[],
    providerThreadId: string | undefined,
  ): ThreadDelta[] {
    const repairedDeltas: ThreadDelta[] = [];
    for (const delta of deltas) {
      if (
        !isCommandCloseDelta(delta) ||
        delta.key.providerItemId === undefined ||
        providerThreadId === undefined
      ) {
        repairedDeltas.push(delta);
        continue;
      }

      const callId = delta.key.providerItemId;
      const rawCommandOutputState =
        rawCommandOutputStateByProviderThreadId.get(providerThreadId);
      if (!rawCommandOutputState?.capturedCommandOutputByCallId.has(callId)) {
        if (rawCommandOutputState?.shellToolCallIds.has(callId)) {
          rawCommandOutputState.pendingCloseDeltaByCallId.set(callId, delta);
          continue;
        }
        repairedDeltas.push(delta);
        continue;
      }
      const capturedOutput = consumeCapturedCommandOutput({
        commandExecutionId: callId,
        providerThreadId,
      });
      repairedDeltas.push(repairCommandCloseDelta(delta, capturedOutput));
    }
    return repairedDeltas;
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

  function translateEvent(event: ProviderRuntimeEvent): ThreadDelta[] {
    clearClosedThreadState(event);
    const rawResponseDeltas = consumeCodexRawResponseItem(event);
    if (rawResponseDeltas !== null) {
      return rawResponseDeltas;
    }

    const providerThreadId = extractCodexProviderThreadId(event);
    const subAgentActivityDeltas = translateCodexSubAgentActivity(event);
    if (subAgentActivityDeltas !== null) {
      return reconcileRawCommandOutputLifecycle(
        applyRecoveredCommandOutput(subAgentActivityDeltas, providerThreadId),
        providerThreadId,
      );
    }

    const parentLinkedDeltas = attachCodexDelegationParentLinks(
      translateCodexEventToDeltas(event, eventTranslationState),
      providerThreadId,
    );
    const translatedDeltas = parentLinkedDeltas.flatMap((delta) =>
      attachAcceptedInputCorrelation(delta, providerThreadId),
    );
    const completedSubAgentDeltas =
      completeFinishedCodexSubAgentTurns(translatedDeltas);
    return reconcileRawCommandOutputLifecycle(
      applyRecoveredCommandOutput(completedSubAgentDeltas, providerThreadId),
      providerThreadId,
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

function buildSubAgentToolShape(
  tracked: CodexTrackedSubAgent,
  terminal: boolean,
): DeltaItemShape {
  return {
    type: "tool",
    tool: "spawnAgent",
    args: {
      senderThreadId: tracked.parentProviderThreadId,
      receiverThreadIds: [tracked.agentThreadId],
      description: tracked.agentPath,
    },
    ...(terminal
      ? {
          result: {
            agentPath: tracked.agentPath,
            agentThreadId: tracked.agentThreadId,
          },
        }
      : {}),
  };
}

function buildCodexSubAgentOpenDelta(
  tracked: CodexTrackedSubAgent,
): ThreadDelta {
  return {
    kind: "item.open",
    key: {
      providerItemId: tracked.callId,
      ...(tracked.parentToolCallId
        ? { parentRef: tracked.parentToolCallId }
        : {}),
    },
    item: buildSubAgentToolShape(tracked, false),
    providerTurnId: tracked.parentTurnId,
  };
}

function buildCodexSubAgentCloseDelta(args: {
  status: Exclude<ThreadEventItemStatus, "pending">;
  tracked: CodexTrackedSubAgent;
}): ThreadDelta {
  return {
    kind: "item.close",
    key: {
      providerItemId: args.tracked.callId,
      ...(args.tracked.parentToolCallId
        ? { parentRef: args.tracked.parentToolCallId }
        : {}),
    },
    status: args.status,
    item: buildSubAgentToolShape(args.tracked, true),
    providerTurnId: args.tracked.parentTurnId,
  };
}
