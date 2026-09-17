import { ExecutionOutput, ExecutionOutputQueue } from "./execution-output.js";
import type {
  JsonObject,
  ThreadEventItemPresentation,
  ThreadEventScope,
} from "@bb/domain";
import type {
  EventProjectionApprovalLifecycleStatus,
  EventProjectionMessage,
  EventProjection,
  EventProjectionToolCallMessage,
  EventProjectionToolParsedIntent,
} from "./event-projection-types.js";
import type { EventMeta } from "./event-decode.js";
import type {
  ExecutionOutputUpdate,
  ProviderExecutionUpdate,
} from "./exec-lifecycle.js";
import { messageId } from "./format-helpers.js";
import {
  eventProjectionMessageThreadScopeFields,
  eventProjectionMessageTurnScopeFields,
} from "./message-scope.js";
import {
  appendVisibleTextBuffer,
  flushVisibleTextBuffer,
  getVisibleTextBufferFullLength,
  getVisibleTextBufferFullText,
  getVisibleTextBufferText,
  setVisibleTextBuffer,
} from "./visible-text-buffer.js";
import {
  findExecMessageInActiveCell,
  findExecMessageInHistoryCells,
  flushActiveToolCell,
  isProviderExecutionMessage,
  isWebActivityMessage,
  type ToolActivityCell,
  type ViewProviderExecutionMessage,
  type ViewWebActivityMessage,
} from "./tool-activity-cells.js";

type InterruptibleToolMessage =
  | ViewProviderExecutionMessage
  | ViewWebActivityMessage;
type InterruptibleToolCall = Pick<
  ViewProviderExecutionMessage,
  "completedAt" | "output" | "status"
>;
interface ExecutionCompletionTarget {
  completedAt: number | null;
  status: ViewProviderExecutionMessage["status"];
}

interface ExecutionCompletionSource {
  completedAt?: number | null;
  status?: ViewProviderExecutionMessage["status"];
}

interface RunningExecutionBase {
  callId: string;
  threadId: string;
  scope: ThreadEventScope;
  parentToolCallId?: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  startedAt: number;
  output: ExecutionOutput;
  completedAt: number | null;
  status: ViewProviderExecutionMessage["status"];
  presentation?: ThreadEventItemPresentation;
}

interface PendingExecutionOutput {
  callId: string;
  parentToolCallId?: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  startedAt: number;
  output: ExecutionOutput;
  status?: ViewProviderExecutionMessage["status"];
}

type BufferedExecutionOutput = RunningExecCall | PendingExecutionOutput;

interface RunningCommandExecution extends RunningExecutionBase {
  kind: "command";
  command: string;
  cwd: string | null;
  parsedIntents: EventProjectionToolParsedIntent[];
  source: string | null;
  exitCode: number | null;
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
}

interface RunningToolCallExecution extends RunningExecutionBase {
  kind: "tool-call";
  toolName: string | null;
  toolArgs: JsonObject | null;
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
}

interface RunningDelegationExecution extends RunningExecutionBase {
  kind: "delegation";
  toolName: string | null;
  childRef: string | null;
  background: boolean;
  subagentType?: string;
  description?: string;
  model?: string;
}

type RunningExecCall =
  | RunningCommandExecution
  | RunningToolCallExecution
  | RunningDelegationExecution;

type ApprovalStatusDelta =
  | { kind: "keep" }
  | { kind: "set"; value: EventProjectionApprovalLifecycleStatus | null };

export interface ToolActivityProjectionState {
  messages: EventProjectionMessage[];
  toolActivity: ToolActivityState;
}

interface ToolActivityState {
  outputQueuesByCallId: Map<string, ExecutionOutputQueue>;
  runningCallsById: Map<string, RunningExecCall>;
  pendingOutputsByCallId: Map<string, PendingExecutionOutput>;
  activeCell: ToolActivityCell | null;
  historyCells: ToolActivityCell[];
  execHistoryCellIndexByCallId: Map<string, number>;
  finalizedExecCallIds: Set<string>;
  finalizedWebActivityCallIds: Set<string>;
}

interface MergeCallSummaryOptions {
  appendOutput?: boolean;
  replaceOutput?: boolean;
  visibleOutput?: ExecutionOutput;
}

interface InterruptPendingToolActivityArgs {
  completedAt: number | null;
  turnIds?: ReadonlySet<string>;
}

const DEFAULT_INTERRUPT_PENDING_TOOL_ACTIVITY_ARGS: InterruptPendingToolActivityArgs =
  {
    completedAt: null,
  };

export function createToolActivityState(): ToolActivityState {
  return {
    outputQueuesByCallId: new Map(),
    runningCallsById: new Map(),
    pendingOutputsByCallId: new Map(),
    activeCell: null,
    historyCells: [],
    execHistoryCellIndexByCallId: new Map(),
    finalizedExecCallIds: new Set(),
    finalizedWebActivityCallIds: new Set(),
  };
}

function emptyEventProjection(): EventProjection {
  return {
    entries: [],
    state: {
      activeThinking: null,
      activeWorkflows: [],
      activeBackgroundCommands: [],
    },
  };
}

function mergeCallStatus(
  current: EventProjectionToolCallMessage["status"] | undefined,
  incoming: EventProjectionToolCallMessage["status"] | undefined,
): EventProjectionToolCallMessage["status"] | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === "error") return "error";
  if (isTerminalToolCallStatus(current)) return current;
  return incoming;
}

export function buildApprovalStatusDelta(
  incoming: EventProjectionApprovalLifecycleStatus | null | undefined,
  incomingStatus: EventProjectionToolCallMessage["status"] | undefined,
): ApprovalStatusDelta {
  if (incoming !== undefined) {
    return { kind: "set", value: incoming };
  }
  if (incomingStatus !== undefined) {
    return { kind: "set", value: null };
  }
  return { kind: "keep" };
}

export function applyApprovalStatusDelta(
  current: EventProjectionApprovalLifecycleStatus | null,
  delta: ApprovalStatusDelta,
): EventProjectionApprovalLifecycleStatus | null {
  switch (delta.kind) {
    case "keep":
      return current;
    case "set":
      return delta.value;
  }
}

function hasSemanticIntent(
  intents: EventProjectionToolParsedIntent[],
): boolean {
  return intents.some((intent) => intent.type !== "unknown");
}

function chooseParsedIntents(
  existing: EventProjectionToolParsedIntent[],
  incoming: EventProjectionToolParsedIntent[],
): EventProjectionToolParsedIntent[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  if (!hasSemanticIntent(existing) && hasSemanticIntent(incoming)) {
    return incoming;
  }
  if (incoming.length > existing.length) return incoming;
  return existing;
}

function isTerminalToolCallStatus(
  status: EventProjectionToolCallMessage["status"] | undefined,
): boolean {
  return status !== undefined && status !== "pending";
}

function createExecutionOutput(
  state: ToolActivityProjectionState,
  callId: string,
): ExecutionOutput {
  let queue = state.toolActivity.outputQueuesByCallId.get(callId);
  if (!queue) {
    queue = new ExecutionOutputQueue();
    state.toolActivity.outputQueuesByCallId.set(callId, queue);
  }
  return queue.create();
}

function flushExecutionOutput(output: ExecutionOutput): void {
  output.update((value) => {
    flushVisibleTextBuffer(value.outputBuffer);
    value.output = getVisibleTextBufferText(value.outputBuffer) ?? "";
  });
}

interface CreateRunningExecutionBaseArgs {
  output: ExecutionOutput;
  incoming: ProviderExecutionUpdate;
  meta: EventMeta;
  scope: ThreadEventScope;
  threadId: string;
}

function createRunningExecutionBase({
  output,
  incoming,
  meta,
  scope,
  threadId,
}: CreateRunningExecutionBaseArgs): RunningExecutionBase {
  const text = incoming.output;
  const terminal = isTerminalToolCallStatus(incoming.status);
  if (text && text.length > 0) {
    output.update((value) => {
      setVisibleTextBuffer(value.outputBuffer, text, terminal);
      value.output = getVisibleTextBufferText(value.outputBuffer) ?? "";
    });
  }

  return {
    callId: incoming.callId,
    threadId,
    scope,
    ...(incoming.parentToolCallId
      ? { parentToolCallId: incoming.parentToolCallId }
      : {}),
    ...(incoming.presentation ? { presentation: incoming.presentation } : {}),
    output,
    completedAt: incoming.completedAt ?? null,
    status: incoming.status ?? "pending",
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
  };
}

function createRunningExecCall(
  state: ToolActivityProjectionState,
  incoming: ProviderExecutionUpdate,
  meta: EventMeta,
  threadId: string,
  scope: ThreadEventScope,
): RunningExecCall {
  const base = createRunningExecutionBase({
    output: createExecutionOutput(state, incoming.callId),
    incoming,
    meta,
    scope,
    threadId,
  });

  switch (incoming.kind) {
    case "command":
      return {
        ...base,
        kind: "command",
        command: incoming.command ?? "",
        cwd: incoming.cwd ?? null,
        parsedIntents: incoming.parsedIntents ?? [],
        source: incoming.source ?? null,
        exitCode: incoming.exitCode ?? null,
        approvalStatus: incoming.approvalStatus ?? null,
      };
    case "tool-call":
      return {
        ...base,
        kind: "tool-call",
        toolName: incoming.toolName ?? null,
        toolArgs: incoming.toolArgs ?? null,
        approvalStatus: incoming.approvalStatus ?? null,
      };
    case "delegation":
      return {
        ...base,
        kind: "delegation",
        toolName: incoming.toolName ?? null,
        childRef: incoming.childRef ?? null,
        background: incoming.background ?? false,
        subagentType: incoming.subagentType,
        description: incoming.description,
        model: incoming.model,
      };
  }
}

interface CommandExecutionFieldsTarget {
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
  command: string;
  cwd: string | null;
  exitCode: number | null;
  parsedIntents: EventProjectionToolParsedIntent[];
  source: string | null;
}

interface CommandExecutionFieldsSource {
  approvalStatus?: EventProjectionApprovalLifecycleStatus | null;
  command?: string;
  cwd?: string | null;
  exitCode?: number | null;
  parsedIntents?: EventProjectionToolParsedIntent[];
  source?: string | null;
  status?: EventProjectionToolCallMessage["status"];
}

interface ToolCallExecutionFieldsTarget {
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
  toolArgs: JsonObject | null;
  toolName: string | null;
}

interface ToolCallExecutionFieldsSource {
  approvalStatus?: EventProjectionApprovalLifecycleStatus | null;
  status?: EventProjectionToolCallMessage["status"];
  toolArgs?: JsonObject | null;
  toolName?: string | null;
}

interface DelegationExecutionFieldsTarget {
  background: boolean;
  childRef: string | null;
  description?: string;
  model?: string;
  subagentType?: string;
  toolName: string | null;
}

interface DelegationExecutionFieldsSource {
  background?: boolean;
  childRef?: string | null;
  description?: string;
  model?: string;
  subagentType?: string;
  toolName?: string | null;
}

interface PresentedExecutionFieldsTarget {
  presentation?: ThreadEventItemPresentation;
}

interface PresentedExecutionFieldsSource {
  presentation?: ThreadEventItemPresentation;
}

function mergePresentation(
  target: PresentedExecutionFieldsTarget,
  incoming: PresentedExecutionFieldsSource,
): void {
  if (incoming.presentation) {
    target.presentation = incoming.presentation;
  }
}

function mergeCommandExecutionFields(
  target: CommandExecutionFieldsTarget,
  incoming: CommandExecutionFieldsSource,
): void {
  if (incoming.cwd && !target.cwd) target.cwd = incoming.cwd;
  if (incoming.source && !target.source) target.source = incoming.source;
  if (incoming.command && incoming.command !== target.command) {
    target.command = incoming.command;
    target.parsedIntents = incoming.parsedIntents ?? [];
  } else {
    target.parsedIntents = chooseParsedIntents(
      target.parsedIntents,
      incoming.parsedIntents ?? [],
    );
  }
  if (incoming.exitCode !== undefined) target.exitCode = incoming.exitCode;
  target.approvalStatus = applyApprovalStatusDelta(
    target.approvalStatus,
    buildApprovalStatusDelta(incoming.approvalStatus, incoming.status),
  );
}

function mergeToolCallExecutionFields(
  target: ToolCallExecutionFieldsTarget,
  incoming: ToolCallExecutionFieldsSource,
): void {
  if (incoming.toolName && !target.toolName) {
    target.toolName = incoming.toolName;
  }
  if (incoming.toolArgs && !target.toolArgs) {
    target.toolArgs = incoming.toolArgs;
  }
  target.approvalStatus = applyApprovalStatusDelta(
    target.approvalStatus,
    buildApprovalStatusDelta(incoming.approvalStatus, incoming.status),
  );
}

function mergeDelegationExecutionFields(
  target: DelegationExecutionFieldsTarget,
  incoming: DelegationExecutionFieldsSource,
): void {
  if (incoming.toolName && !target.toolName) {
    target.toolName = incoming.toolName;
  }
  if (incoming.childRef && !target.childRef) {
    target.childRef = incoming.childRef;
  }
  if (incoming.background === true) {
    target.background = true;
  }
  if (incoming.subagentType && !target.subagentType) {
    target.subagentType = incoming.subagentType;
  }
  if (
    incoming.description &&
    (!target.description || incoming.childRef !== undefined)
  ) {
    target.description = incoming.description;
  }
  if (incoming.model && !target.model) {
    target.model = incoming.model;
  }
}

function mergeExecutionCompletion(
  target: ExecutionCompletionTarget,
  incoming: ExecutionCompletionSource,
): void {
  if (incoming.completedAt === undefined || incoming.completedAt === null) {
    return;
  }

  if (target.status === "interrupted" && incoming.status !== "error") {
    return;
  }

  target.completedAt = incoming.completedAt;
}

function mergeRunningExecutionMetadata(
  existing: RunningExecCall,
  incoming: ProviderExecutionUpdate,
): void {
  mergePresentation(existing, incoming);
  switch (incoming.kind) {
    case "command":
      if (existing.kind !== "command") return;
      mergeCommandExecutionFields(existing, incoming);
      return;
    case "tool-call":
      if (existing.kind !== "tool-call") return;
      mergeToolCallExecutionFields(existing, incoming);
      return;
    case "delegation":
      if (existing.kind !== "delegation") return;
      mergeDelegationExecutionFields(existing, incoming);
      return;
  }
}

function upsertRunningExecCall(
  state: ToolActivityProjectionState,
  existing: RunningExecCall | undefined,
  incoming: ProviderExecutionUpdate,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
): RunningExecCall {
  if (!existing) {
    const scopeFields = turnId
      ? eventProjectionMessageTurnScopeFields(turnId)
      : eventProjectionMessageThreadScopeFields();
    return createRunningExecCall(
      state,
      incoming,
      meta,
      threadId,
      scopeFields.scope,
    );
  }

  mergeRunningExecutionMetadata(existing, incoming);
  mergeExecutionCompletion(existing, incoming);
  if (!existing.parentToolCallId && incoming.parentToolCallId) {
    existing.parentToolCallId = incoming.parentToolCallId;
  }

  const text = incoming.output;
  const terminal = isTerminalToolCallStatus(incoming.status);
  if (text && text.length > 0) {
    existing.output.update((value) => {
      if (
        terminal ||
        text.length >= getVisibleTextBufferFullLength(value.outputBuffer)
      ) {
        setVisibleTextBuffer(value.outputBuffer, text, terminal);
        value.output = getVisibleTextBufferText(value.outputBuffer) ?? "";
      }
    });
  }

  existing.threadId = threadId;
  existing.status =
    mergeCallStatus(existing.status, incoming.status) ?? "pending";
  existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
  existing.createdAt = Math.max(existing.createdAt, meta.createdAt);

  return existing;
}

function applyExecutionOutputUpdate(
  target: BufferedExecutionOutput,
  incoming: ExecutionOutputUpdate,
  appendOutput?: boolean,
  replaceOutput?: boolean,
): void {
  const text = incoming.output;
  const terminal = isTerminalToolCallStatus(incoming.status);
  target.output.update((value) => {
    if (appendOutput) {
      if (!text) return;
      appendVisibleTextBuffer(value.outputBuffer, text);
    } else if (replaceOutput) {
      setVisibleTextBuffer(value.outputBuffer, text, terminal);
    } else if (
      text.length >= getVisibleTextBufferFullLength(value.outputBuffer)
    ) {
      setVisibleTextBuffer(value.outputBuffer, text, true);
    }
    value.output = getVisibleTextBufferText(value.outputBuffer) ?? "";
  });
}

function upsertPendingExecutionOutput(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  incoming: ExecutionOutputUpdate,
  appendOutput?: boolean,
  replaceOutput?: boolean,
): void {
  let pending = state.toolActivity.pendingOutputsByCallId.get(incoming.callId);
  if (!pending) {
    pending = {
      callId: incoming.callId,
      ...(incoming.parentToolCallId
        ? { parentToolCallId: incoming.parentToolCallId }
        : {}),
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      output: createExecutionOutput(state, incoming.callId),
      status: incoming.status,
    };
    state.toolActivity.pendingOutputsByCallId.set(incoming.callId, pending);
  }

  applyExecutionOutputUpdate(pending, incoming, appendOutput, replaceOutput);
  pending.sourceSeqEnd = Math.max(pending.sourceSeqEnd, meta.seq);
  pending.createdAt = Math.max(pending.createdAt, meta.createdAt);
  if (!pending.parentToolCallId && incoming.parentToolCallId) {
    pending.parentToolCallId = incoming.parentToolCallId;
  }
  pending.status = mergeCallStatus(pending.status, incoming.status);
}

function applyPendingExecutionOutput(
  state: ToolActivityProjectionState,
  call: RunningExecCall,
): void {
  const pending = state.toolActivity.pendingOutputsByCallId.get(call.callId);
  if (!pending) {
    return;
  }

  if (isTerminalToolCallStatus(call.status)) {
    flushExecutionOutput(pending.output);
  }
  reconcilePendingExecutionOutput(call, pending);
  call.sourceSeqStart = Math.min(call.sourceSeqStart, pending.sourceSeqStart);
  call.sourceSeqEnd = Math.max(call.sourceSeqEnd, pending.sourceSeqEnd);
  call.startedAt = Math.min(call.startedAt, pending.startedAt);
  call.createdAt = Math.max(call.createdAt, pending.createdAt);
  if (!call.parentToolCallId && pending.parentToolCallId) {
    call.parentToolCallId = pending.parentToolCallId;
  }
  call.status = mergeCallStatus(call.status, pending.status) ?? call.status;
  state.toolActivity.pendingOutputsByCallId.delete(call.callId);
}

function reconcilePendingExecutionOutput(
  call: RunningExecCall,
  pending: PendingExecutionOutput,
): void {
  const terminal = isTerminalToolCallStatus(call.status);
  call.output.with(pending.output, (value, pendingValue) => {
    const pendingText = getVisibleTextBufferFullText(pendingValue.outputBuffer);
    if (pendingText.length === 0) return;
    const callText = getVisibleTextBufferFullText(value.outputBuffer);
    if (callText.includes(pendingText)) return;
    const reconciledText = pendingText.includes(callText)
      ? pendingText
      : `${pendingText}${callText}`;
    setVisibleTextBuffer(value.outputBuffer, reconciledText, terminal);
    value.output = getVisibleTextBufferText(value.outputBuffer) ?? "";
  });
}

function shouldInterruptToolScope(
  scope: ThreadEventScope,
  args: InterruptPendingToolActivityArgs,
): boolean {
  return (
    args.turnIds === undefined ||
    (scope.kind === "turn" && args.turnIds.has(scope.turnId))
  );
}

function interruptPendingToolCall(
  call: InterruptibleToolCall,
  completedAt: number | null,
): void {
  if (call.status !== "pending") {
    return;
  }
  call.status = "interrupted";
  call.completedAt = completedAt;
  call.output.update((value) => {
    if (!value.output) value.output = "Tool execution interrupted";
  });
}

function interruptPendingToolMessage(
  message: InterruptibleToolMessage,
  completedAt: number | null,
): void {
  switch (message.kind) {
    case "command":
    case "tool-call":
    case "delegation":
      interruptPendingToolCall(message, completedAt);
      return;
    case "web-search":
    case "web-fetch":
    case "image-generation":
    case "image-view":
    case "file-read":
    case "search":
    case "plan-steps":
    case "extension":
      if (message.status === "pending") {
        message.status = "interrupted";
        message.completedAt = completedAt;
      }
      return;
  }
}

function isInterruptibleToolMessage(
  message: EventProjectionMessage,
): message is InterruptibleToolMessage {
  return isProviderExecutionMessage(message) || isWebActivityMessage(message);
}

type ExecutionMergeTarget = RunningExecCall | ViewProviderExecutionMessage;
type ExecutionMergeSource =
  | RunningExecCall
  | ProviderExecutionUpdate
  | ExecutionOutputUpdate;

function mergeExecutionOutput(
  target: ExecutionMergeTarget,
  incoming: ExecutionMergeSource,
  options: MergeCallSummaryOptions,
): void {
  const { appendOutput, replaceOutput, visibleOutput } = options;
  if (visibleOutput !== undefined) {
    target.output.mergeText(visibleOutput, (value, text) => {
      value.output = text;
    });
  } else if (incoming.output !== undefined) {
    target.output.mergeText(incoming.output, (value, text) => {
      if (text.length === 0) return;
      if (appendOutput) value.output += text;
      else if (replaceOutput || text.length >= value.output.length)
        value.output = text;
    });
  }
}

function mergeExecutionSummary(
  target: ExecutionMergeTarget,
  incoming: ExecutionMergeSource,
  options: MergeCallSummaryOptions = {},
): void {
  mergeExecutionOutput(target, incoming, options);
  if ("kind" in incoming) {
    if (target.kind !== incoming.kind) {
      throw new Error(
        `Cannot merge ${target.kind} with ${incoming.kind} for call ${incoming.callId}`,
      );
    }
    mergePresentation(target, incoming);
    switch (incoming.kind) {
      case "command":
        if (target.kind !== "command") return;
        mergeCommandExecutionFields(target, incoming);
        break;
      case "tool-call":
        if (target.kind !== "tool-call") return;
        mergeToolCallExecutionFields(target, incoming);
        break;
      case "delegation":
        if (target.kind !== "delegation") return;
        mergeDelegationExecutionFields(target, incoming);
        break;
    }
    mergeExecutionCompletion(target, incoming);
  }
  target.status =
    mergeCallStatus(target.status, incoming.status) ?? target.status;
}

export function flushToolActivityBeforeNonToolMessage(
  state: ToolActivityProjectionState,
): void {
  flushActiveToolCell(state);
}

export function flushPendingToolActivityOutput(
  state: ToolActivityProjectionState,
): void {
  for (const call of state.toolActivity.runningCallsById.values()) {
    const activeCall = findExecMessageInActiveCell(
      state.toolActivity.activeCell,
      call.callId,
    );
    const historyMatch = findExecMessageInHistoryCells(state, call.callId);
    let flushed = false;
    call.output.update((value) => {
      flushed = flushVisibleTextBuffer(value.outputBuffer);
      if (flushed)
        value.output = getVisibleTextBufferText(value.outputBuffer) ?? "";
    });
    if (activeCall)
      activeCall.output.with(call.output, (target, source) => {
        if (flushed) target.output = source.output;
      });
    if (historyMatch)
      historyMatch.call.output.with(call.output, (target, source) => {
        if (flushed) target.output = source.output;
      });
  }
}

export function interruptPendingToolActivity(
  state: ToolActivityProjectionState,
  args: InterruptPendingToolActivityArgs = DEFAULT_INTERRUPT_PENDING_TOOL_ACTIVITY_ARGS,
): void {
  const interruptedRunningCallIds: string[] = [];
  for (const call of state.toolActivity.runningCallsById.values()) {
    if (!shouldInterruptToolScope(call.scope, args)) {
      continue;
    }

    flushExecutionOutput(call.output);
    interruptPendingToolCall(call, args.completedAt);

    const activeCall = findExecMessageInActiveCell(
      state.toolActivity.activeCell,
      call.callId,
    );
    if (activeCall) {
      mergeExecutionSummary(activeCall, call);
      interruptedRunningCallIds.push(call.callId);
      continue;
    }

    const historyMatch = findExecMessageInHistoryCells(state, call.callId);
    if (historyMatch) {
      mergeExecutionSummary(historyMatch.call, call);
      interruptedRunningCallIds.push(call.callId);
      continue;
    }

    state.messages.push(createExecMessage(call));
    interruptedRunningCallIds.push(call.callId);
  }

  for (const callId of interruptedRunningCallIds) {
    state.toolActivity.runningCallsById.delete(callId);
  }

  if (
    state.toolActivity.activeCell &&
    shouldInterruptToolScope(state.toolActivity.activeCell.scope, args)
  ) {
    interruptPendingToolMessage(
      state.toolActivity.activeCell,
      args.completedAt,
    );
  }

  for (const cell of state.toolActivity.historyCells) {
    if (shouldInterruptToolScope(cell.scope, args)) {
      interruptPendingToolMessage(cell, args.completedAt);
    }
  }

  for (const message of state.messages) {
    if (
      isInterruptibleToolMessage(message) &&
      shouldInterruptToolScope(message.scope, args)
    ) {
      interruptPendingToolMessage(message, args.completedAt);
    }
  }
}

function createExecMessage(
  call: RunningExecCall,
): ViewProviderExecutionMessage {
  const rowKindForId = call.kind === "tool-call" ? "tool" : call.kind;
  const base = {
    id: messageId(call.threadId, rowKindForId, call.callId),
    threadId: call.threadId,
    sourceSeqStart: call.sourceSeqStart,
    sourceSeqEnd: call.sourceSeqEnd,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    scope: call.scope,
    ...(call.parentToolCallId
      ? { parentToolCallId: call.parentToolCallId }
      : {}),
    ...(call.presentation ? { presentation: call.presentation } : {}),
    callId: call.callId,
    output: call.output.copy(),
    completedAt: call.completedAt,
    status: call.status,
  };

  if (call.kind === "command") {
    return {
      ...base,
      kind: "command",
      command: call.command,
      cwd: call.cwd,
      parsedIntents: call.parsedIntents,
      source: call.source,
      exitCode: call.exitCode,
      approvalStatus: call.approvalStatus,
    };
  }

  if (call.kind === "delegation") {
    return {
      ...base,
      kind: "delegation",
      toolName: call.toolName ?? "delegation",
      childRef: call.childRef,
      background: call.background,
      subagentType: call.subagentType,
      description: call.description,
      model: call.model,
      getChildProjection: emptyEventProjection,
    };
  }

  return {
    ...base,
    kind: "tool-call",
    toolName: call.toolName ?? "tool",
    toolArgs: call.toolArgs,
    approvalStatus: call.approvalStatus,
  };
}

export function onExecBegin(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  incoming: ProviderExecutionUpdate,
): void {
  const existingRunning = state.toolActivity.runningCallsById.get(
    incoming.callId,
  );
  const call = upsertRunningExecCall(
    state,
    existingRunning,
    incoming,
    meta,
    threadId,
    turnId,
  );
  applyPendingExecutionOutput(state, call);
  state.toolActivity.runningCallsById.set(call.callId, call);

  const existingInActive = findExecMessageInActiveCell(
    state.toolActivity.activeCell,
    call.callId,
  );
  if (existingInActive) {
    mergeExecutionSummary(existingInActive, call);
    if (isProviderExecutionMessage(state.toolActivity.activeCell)) {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        call.sourceSeqEnd,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        call.createdAt,
      );
    }
    return;
  }

  flushActiveToolCell(state);
  state.toolActivity.activeCell = createExecMessage(call);
}

export function onExecOutput(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  incoming: ExecutionOutputUpdate,
  appendOutput?: boolean,
  replaceOutput?: boolean,
): void {
  const existingRunning = state.toolActivity.runningCallsById.get(
    incoming.callId,
  );
  if (existingRunning) {
    applyExecutionOutputUpdate(
      existingRunning,
      incoming,
      appendOutput,
      replaceOutput,
    );
    mergeExecutionSummary(existingRunning, incoming, {
      appendOutput,
      replaceOutput,
      visibleOutput: existingRunning.output,
    });
    existingRunning.sourceSeqEnd = Math.max(
      existingRunning.sourceSeqEnd,
      meta.seq,
    );
    existingRunning.createdAt = Math.max(
      existingRunning.createdAt,
      meta.createdAt,
    );
  }

  const activeCall = findExecMessageInActiveCell(
    state.toolActivity.activeCell,
    incoming.callId,
  );
  if (activeCall) {
    mergeExecutionSummary(activeCall, incoming, {
      appendOutput,
      replaceOutput,
      visibleOutput: existingRunning?.output,
    });
    if (isProviderExecutionMessage(state.toolActivity.activeCell)) {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        meta.seq,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        meta.createdAt,
      );
    }
  }

  const historyMatch = findExecMessageInHistoryCells(state, incoming.callId);
  if (!historyMatch) {
    if (!existingRunning && !activeCall) {
      upsertPendingExecutionOutput(
        state,
        meta,
        incoming,
        appendOutput,
        replaceOutput,
      );
    }
    return;
  }

  mergeExecutionSummary(historyMatch.call, incoming, {
    appendOutput,
    replaceOutput,
    visibleOutput: existingRunning?.output,
  });
  historyMatch.cell.sourceSeqEnd = Math.max(
    historyMatch.cell.sourceSeqEnd,
    meta.seq,
  );
  historyMatch.cell.createdAt = Math.max(
    historyMatch.cell.createdAt,
    meta.createdAt,
  );

  historyMatch.cell.status =
    mergeCallStatus(historyMatch.cell.status, incoming.status) ??
    historyMatch.cell.status;
}

export function onExecEnd(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  incoming: ProviderExecutionUpdate,
): void {
  const running = state.toolActivity.runningCallsById.get(incoming.callId);
  const merged = upsertRunningExecCall(
    state,
    running,
    incoming,
    meta,
    threadId,
    turnId,
  );
  applyPendingExecutionOutput(state, merged);
  if (isTerminalToolCallStatus(merged.status)) {
    flushExecutionOutput(merged.output);
  }
  state.toolActivity.runningCallsById.delete(incoming.callId);

  const active = state.toolActivity.activeCell;
  const existingInActive = findExecMessageInActiveCell(active, incoming.callId);
  if (existingInActive) {
    mergeExecutionSummary(existingInActive, merged, {
      visibleOutput: merged.output,
    });
    if (isProviderExecutionMessage(active)) {
      active.sourceSeqEnd = Math.max(active.sourceSeqEnd, merged.sourceSeqEnd);
      active.createdAt = Math.max(active.createdAt, merged.createdAt);
      state.toolActivity.finalizedExecCallIds.add(incoming.callId);
      flushActiveToolCell(state);
      return;
    }
  }

  if (
    state.toolActivity.finalizedExecCallIds.has(incoming.callId) &&
    merged.status !== "error"
  ) {
    return;
  }

  const historyMatch = findExecMessageInHistoryCells(state, incoming.callId);
  if (historyMatch) {
    mergeExecutionSummary(historyMatch.call, merged, {
      visibleOutput: merged.output,
    });
    historyMatch.cell.sourceSeqEnd = Math.max(
      historyMatch.cell.sourceSeqEnd,
      merged.sourceSeqEnd,
    );
    historyMatch.cell.createdAt = Math.max(
      historyMatch.cell.createdAt,
      merged.createdAt,
    );

    state.toolActivity.finalizedExecCallIds.add(incoming.callId);
    return;
  }

  flushActiveToolCell(state);

  const execMessage = createExecMessage(merged);
  execMessage.status =
    mergeCallStatus(execMessage.status, incoming.status) ?? execMessage.status;
  state.toolActivity.activeCell = execMessage;
  flushActiveToolCell(state);
}
