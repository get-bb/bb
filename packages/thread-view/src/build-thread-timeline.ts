import type {
  ThreadContextWindowUsage,
  TimelineConversationAttachments,
  TimelineFeedRow,
  TimelineParentChange,
  TimelineRow,
  TimelineRowBase,
  TimelineRowStatus,
  TimelineSourceRow,
  TimelineSystemOperationKind,
  TimelineSystemRow,
  TimelineTurnRow,
  TimelineUserConversationRow,
  ThreadTimelineFeedResponse,
} from "@bb/server-contract";
import {
  readTerminalOutputLines,
  type ActiveThinking,
  type Thread,
  type ThreadTimelinePendingTodos,
} from "@bb/domain";
import type {
  EventProjectionErrorMessage,
  EventProjectionMessage,
  EventProjection,
  EventProjectionProvisioningTranscriptEntry,
  EventProjectionTurn,
} from "./event-projection-types.js";
import { assertNever } from "./assert-never.js";
import {
  durationToCompactString,
  getMessageStartedAt,
} from "./format-helpers.js";
import { getEventProjectionMessageScopeTurnId } from "./message-scope.js";
import {
  buildEventProjection,
  buildEventProjectionEntries,
  type ThreadEventWithMeta,
} from "./build-event-projection.js";
import {
  buildAcceptedClientRequestById,
  type AcceptedClientRequestContext,
} from "./accepted-client-request-context.js";
import { parsePendingSteerFromClientRequest } from "./user-message-parsing.js";
import { getOrderedThreadEvents } from "./group-event-projection-turns.js";
import {
  groupCompletedTurnMessages,
  type CompletedTurnSummaryItem,
} from "./completed-turn-grouping.js";
import { extractThreadContextWindowUsage } from "./thread-context-window-usage.js";
import { extractThreadTimelinePendingTodos } from "./todo-snapshot-extraction.js";
import { buildTimelineErrorDisplay } from "./error-display.js";
import {
  buildTimelineFeedRows,
  type TimelineFeedFileDiffLookupFactory,
  type TimelineFeedRowKeyBuilder,
} from "./timeline-feed.js";
import {
  tryPaginateTimelineRows,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";
import {
  buildTimelineWorkRowsFromMessage,
  type BuildDelegationChildRowsArgs,
  type TimelineDelegationChildRowsMode,
} from "./timeline-work-row-builders.js";

export type ThreadTimelineTurnMessageDetail = "summary" | "full";

interface ThreadTimelineFromEventsBaseOptions {
  includeDebugRawEvents: boolean;
  includeProviderUnhandledOperations: boolean;
  /**
   * Tail-only state (`pendingTodos`) is only meaningful on the latest page —
   * the snapshot describes current head state, not historical state. Caller
   * passes false on older-page requests so the projection can skip the
   * extraction work entirely instead of computing it and discarding.
   */
  isLatestPage: boolean;
  threadStatus: Thread["status"];
  /**
   * Absolute path of the thread's workspace root, used to relativize the
   * absolute file paths persisted by provider file-edit tool calls. Null when
   * the thread has no environment (the path is then left as-is).
   */
  workspaceRoot: string | null;
}

export interface ThreadTimelineFromEventsOptions extends ThreadTimelineFromEventsBaseOptions {
  includeNestedRows: boolean;
  turnMessageDetail: ThreadTimelineTurnMessageDetail;
}

export interface BuildThreadTimelineFromEventsArgs {
  acceptedClientRequestContext: AcceptedClientRequestContext;
  contextWindowEvents: ThreadEventWithMeta[];
  events: ThreadEventWithMeta[];
  options: ThreadTimelineFromEventsOptions;
}

export interface ThreadTimelineFromEventsResult {
  activeThinking: ActiveThinking | null;
  contextWindowUsage: ThreadContextWindowUsage | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  rows: TimelineRow[];
}

export interface ThreadTimelineFeedFromEventsOptions extends ThreadTimelineFromEventsBaseOptions {
  fileDiffLookupForRows: TimelineFeedFileDiffLookupFactory;
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  rowKeyForRow: TimelineFeedRowKeyBuilder;
  summaryOnly: boolean;
}

export interface BuildThreadTimelineFeedFromEventsArgs {
  acceptedClientRequestContext: AcceptedClientRequestContext;
  contextWindowEvents: ThreadEventWithMeta[];
  events: ThreadEventWithMeta[];
  options: ThreadTimelineFeedFromEventsOptions;
}

export interface ThreadTimelineFeedFromEventsSuccess {
  activeThinking: ActiveThinking | null;
  contextWindowUsage: ThreadContextWindowUsage | undefined;
  kind: "success";
  pendingTodos: ThreadTimelinePendingTodos | null;
  projectedRowCount: number;
  responseRowCount: number;
  rows: TimelineFeedRow[];
  timelinePage: ThreadTimelineFeedResponse["timelinePage"];
}

export interface ThreadTimelineFeedFromEventsMissingCursor {
  kind: "missing-cursor";
}

export type ThreadTimelineFeedFromEventsResult =
  | ThreadTimelineFeedFromEventsSuccess
  | ThreadTimelineFeedFromEventsMissingCursor;

export interface ThreadTimelineSourceSeqRange {
  sourceSeqEnd: number;
  sourceSeqStart: number;
}

export interface BuildThreadTimelineTurnDetailsFromEventsOptions extends ThreadTimelineSourceSeqRange {
  includeProviderUnhandledOperations: boolean;
  threadStatus: Thread["status"];
  turnId: string;
  /** See {@link ThreadTimelineFromEventsBaseOptions.workspaceRoot}. */
  workspaceRoot: string | null;
}

export interface BuildThreadTimelineTurnDetailsFromEventsArgs {
  events: ThreadEventWithMeta[];
  options: BuildThreadTimelineTurnDetailsFromEventsOptions;
}

export type ThreadTimelineTurnDetailsFromEventsResult =
  | {
      kind: "matched";
      rows: TimelineRow[];
    }
  | {
      kind: "missing-match";
    }
  | {
      kind: "ungrouped";
      rows: TimelineRow[];
    };

interface BuildTurnRowsArgs {
  delegationChildRows: TimelineDelegationChildRowsMode;
  includeNestedRows: boolean;
  rowIdPrefix: string;
  turn: EventProjectionTurn;
  workspaceRoot: string | null;
}

interface TimelineMessageBounds {
  createdAt: number;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  startedAt: number;
}

interface BuildTurnSummaryRowArgs {
  completedAt: number | null;
  includeNestedRows: boolean;
  rowIdPrefix: string;
  segmentIndex: number | null;
  sourceMessages: EventProjectionMessage[];
  sourceRows: TimelineRow[];
  startedAt: number;
  summaryCount: number;
  turn: EventProjectionTurn;
}

interface BuildCompletedTurnSummaryRowsArgs {
  delegationChildRows: TimelineDelegationChildRowsMode;
  includeNestedRows: boolean;
  rowIdPrefix: string;
  summaryItems: CompletedTurnSummaryItem[];
  turn: EventProjectionTurn;
  workspaceRoot: string | null;
}

interface BuildTimelineRowsOptions {
  delegationChildRows: TimelineDelegationChildRowsMode;
  includeNestedRows: boolean;
  rowIdPrefix: string;
  workspaceRoot: string | null;
}

interface BuildGenericOperationSystemRowArgs {
  base: TimelineRowBase;
  message: TimelineOperationMessage;
  operationKind: TimelineGenericSystemOperationKind;
}

interface BuildParentChangeSystemRowArgs {
  base: TimelineRowBase;
  parentChange: TimelineParentChange;
  message: TimelineOperationMessage;
}

const ROOT_TIMELINE_ROW_ID_PREFIX = "";

type TimelineOperationMessage = Extract<
  EventProjectionMessage,
  { kind: "operation" }
>;
type TimelineGenericSystemOperationKind = Exclude<
  TimelineSystemOperationKind,
  "parent-change"
>;

function operationKindForMessage(
  message: TimelineOperationMessage,
  parentChange: TimelineParentChange | null,
): TimelineSystemOperationKind {
  switch (message.opType) {
    case "compaction":
    case "thread-provisioning":
    case "thread-interrupted":
    case "provider-unhandled":
    case "warning":
    case "deprecation":
      return message.opType;
    case "operation":
      return parentChange !== null ? "parent-change" : "generic";
    default:
      return assertNever(message.opType);
  }
}

function parentChangeForMessage(
  message: TimelineOperationMessage,
): TimelineParentChange | null {
  if (
    message.opType !== "operation" ||
    message.threadOperation?.operation !== "ownership_change"
  ) {
    return null;
  }

  const metadata = message.threadOperation.metadata;
  if (metadata === null) {
    return null;
  }
  const action = metadata.action;
  switch (action) {
    case "assign":
    case "release":
    case "transfer":
      return {
        action,
        previousParentThreadId: metadata.previousParentThreadId,
        previousParentThreadTitle: metadata.previousParentThreadTitle,
        nextParentThreadId: metadata.nextParentThreadId,
        nextParentThreadTitle: metadata.nextParentThreadTitle,
      };
    default:
      return assertNever(action);
  }
}

function buildGenericOperationSystemRow({
  base,
  message,
  operationKind,
}: BuildGenericOperationSystemRowArgs): TimelineSystemRow {
  return {
    ...base,
    kind: "system",
    systemKind: "operation",
    operationKind,
    title: message.title,
    detail: buildTimelineOperationDetail(message),
    status: message.status ?? null,
    completedAt: message.completedAt,
  };
}

function buildParentChangeSystemRow({
  base,
  parentChange,
  message,
}: BuildParentChangeSystemRowArgs): TimelineSystemRow {
  if (message.status === undefined) {
    throw new Error("Parent change operation message requires a status");
  }
  const status: TimelineRowStatus = message.status;
  return {
    ...base,
    kind: "system",
    systemKind: "operation",
    operationKind: "parent-change",
    parentChange,
    title: message.title,
    detail: buildTimelineOperationDetail(message),
    status,
    completedAt: message.completedAt,
  };
}

function buildTimelineRowBase(
  message: EventProjectionMessage,
  rowIdPrefix: string,
): TimelineRowBase {
  return {
    id: `${rowIdPrefix}${message.id}`,
    threadId: message.threadId,
    turnId: getEventProjectionMessageScopeTurnId(message),
    sourceSeqStart: message.sourceSeqStart,
    sourceSeqEnd: message.sourceSeqEnd,
    startedAt: getMessageStartedAt(message),
    createdAt: message.createdAt,
  };
}

function isReconnectErrorMessage(
  message: EventProjectionErrorMessage,
): boolean {
  return message.reconnectAttempt !== undefined || message.willRetry === true;
}

function toConversationAttachments(
  attachments: Extract<EventProjectionMessage, { kind: "user" }>["attachments"],
): TimelineConversationAttachments | null {
  if (!attachments) {
    return null;
  }
  return {
    webImages: attachments.webImages,
    localImages: attachments.localImages,
    localFiles: attachments.localFiles,
    imageUrls: attachments.imageUrls ?? [],
    localImagePaths: attachments.localImagePaths ?? [],
    localFilePaths: attachments.localFilePaths ?? [],
  };
}

function formatProvisioningTranscriptEntryText(
  entry: EventProjectionProvisioningTranscriptEntry,
): string {
  const durationMs =
    typeof entry.metadata?.durationMs === "number"
      ? entry.metadata.durationMs
      : null;
  if (
    durationMs !== null &&
    (entry.status === "completed" || entry.status === "failed")
  ) {
    return `${entry.text} (${durationToCompactString(durationMs)})`;
  }
  return entry.text;
}

function formatProvisioningTranscriptEntryLines(
  entry: EventProjectionProvisioningTranscriptEntry,
): string[] {
  return readTerminalOutputLines(formatProvisioningTranscriptEntryText(entry));
}

function provisioningTerminalDetailLine(
  message: TimelineOperationMessage,
): string | null {
  if (
    message.opType !== "thread-provisioning" ||
    message.status === "pending" ||
    message.status === undefined ||
    message.startedAt === undefined ||
    message.createdAt < message.startedAt
  ) {
    return null;
  }

  const elapsedMs = message.createdAt - message.startedAt;
  if (elapsedMs <= 1_000) {
    return null;
  }

  const label =
    message.status === "completed"
      ? "Provisioned thread"
      : message.status === "error"
        ? "Provisioning thread failed"
        : "Provisioning thread interrupted";
  return `${label} (${durationToCompactString(elapsedMs)})`;
}

function buildTimelineOperationDetail(
  message: TimelineOperationMessage,
): string | null {
  if (message.opType !== "thread-provisioning") {
    return message.detail ?? null;
  }

  const transcriptLines =
    message.provisioning?.transcript?.flatMap(
      formatProvisioningTranscriptEntryLines,
    ) ?? [];
  const terminalLine = provisioningTerminalDetailLine(message);
  const detailLines = (message.detail ?? "")
    .split(/\n|•/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lines = [...transcriptLines];
  if (terminalLine) {
    lines.push(terminalLine);
  }
  for (const line of detailLines) {
    if (!lines.includes(line)) {
      lines.push(line);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function buildDelegationChildRows({
  projection,
  rowIdPrefix,
  workspaceRoot,
}: BuildDelegationChildRowsArgs): TimelineRow[] {
  return buildTimelineRows(projection, {
    delegationChildRows: "all",
    includeNestedRows: true,
    rowIdPrefix,
    workspaceRoot,
  });
}

function convertMessage(
  message: EventProjectionMessage,
  options: BuildTimelineRowsOptions,
): TimelineSourceRow[] {
  switch (message.kind) {
    case "user":
      return [
        {
          ...buildTimelineRowBase(message, options.rowIdPrefix),
          kind: "conversation",
          role: "user",
          text: message.text,
          mentions: message.mentions,
          attachments: toConversationAttachments(message.attachments),
          initiator: message.initiator,
          senderThreadId: message.senderThreadId,
          turnRequest: message.turnRequest,
        },
      ];
    case "assistant-text":
      return [
        {
          ...buildTimelineRowBase(message, options.rowIdPrefix),
          kind: "conversation",
          role: "assistant",
          text: message.text,
          attachments: null,
          turnRequest: null,
        },
      ];
    case "command":
    case "tool-call":
    case "file-edit":
    case "web-search":
    case "web-fetch":
    case "image-view":
    case "delegation":
    case "workflow":
    case "permission-grant-lifecycle":
    case "user-question-lifecycle":
      return buildTimelineWorkRowsFromMessage({
        base: buildTimelineRowBase(message, options.rowIdPrefix),
        buildDelegationChildRows,
        message,
        options,
      });
    case "operation": {
      const parentChange = parentChangeForMessage(message);
      const operationKind = operationKindForMessage(message, parentChange);
      const base = buildTimelineRowBase(message, options.rowIdPrefix);
      if (operationKind === "parent-change") {
        return parentChange !== null
          ? [
              buildParentChangeSystemRow({
                base,
                parentChange,
                message,
              }),
            ]
          : [
              buildGenericOperationSystemRow({
                base,
                message,
                operationKind: "generic",
              }),
            ];
      }
      return [
        buildGenericOperationSystemRow({
          base,
          message,
          operationKind,
        }),
      ];
    }
    case "error": {
      const errorDisplay = buildTimelineErrorDisplay(message);
      const isReconnect = isReconnectErrorMessage(message);
      return [
        {
          ...buildTimelineRowBase(message, options.rowIdPrefix),
          kind: "system",
          systemKind: isReconnect ? "reconnect" : "error",
          title: errorDisplay.title,
          detail: errorDisplay.detail,
          // Reconnect rows are transient informational markers, not in-progress
          // work, so they carry no lifecycle status. That keeps them from
          // shimmering or lingering as "pending" once an attempt is superseded
          // by the next one or by a terminal failure.
          status: isReconnect ? null : "error",
        },
      ];
    }
    case "debug/raw-event":
      return [
        {
          ...buildTimelineRowBase(message, options.rowIdPrefix),
          kind: "system",
          systemKind: "debug",
          title: message.rawType,
          detail: JSON.stringify(message.rawEvent),
          status: null,
        },
      ];
    default:
      return assertNever(message);
  }
}

function convertPendingSteerMessage(
  message: EventProjectionMessage,
  rowIdPrefix: string,
): TimelineUserConversationRow {
  if (message.kind !== "user" || message.turnRequest.kind !== "steer") {
    throw new Error(`Expected pending steer message, received ${message.kind}`);
  }
  return {
    ...buildTimelineRowBase(message, rowIdPrefix),
    kind: "conversation",
    role: "user",
    text: message.text,
    mentions: message.mentions,
    attachments: toConversationAttachments(message.attachments),
    initiator: message.initiator,
    senderThreadId: message.senderThreadId,
    turnRequest: message.turnRequest,
  };
}

function buildPendingSteerRowsFromEvents(
  acceptedClientRequestContext: AcceptedClientRequestContext,
  events: ThreadEventWithMeta[],
  options: ThreadTimelineFromEventsBaseOptions,
): TimelineUserConversationRow[] {
  const orderedEvents = getOrderedThreadEvents(events);
  const acceptedClientRequestById = buildAcceptedClientRequestById({
    context: acceptedClientRequestContext,
    events: orderedEvents,
  });
  const pendingSteerRows: TimelineUserConversationRow[] = [];

  for (const { event, meta } of orderedEvents) {
    const pendingSteer = parsePendingSteerFromClientRequest({
      acceptedClientRequest:
        event.type === "client/turn/requested"
          ? acceptedClientRequestById.get(event.requestId)
          : undefined,
      decoded: event,
      meta,
      options,
    });
    if (!pendingSteer) {
      continue;
    }
    pendingSteerRows.push(
      convertPendingSteerMessage(pendingSteer, ROOT_TIMELINE_ROW_ID_PREFIX),
    );
  }

  return pendingSteerRows;
}

function isReconnectSystemRow(row: TimelineRow): boolean {
  return row.kind === "system" && row.systemKind === "reconnect";
}

function isErrorSystemRow(row: TimelineRow): boolean {
  return row.kind === "system" && row.systemKind === "error";
}

function isThreadInterruptedOperationRow(row: TimelineRow): boolean {
  return (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "thread-interrupted"
  );
}

function isCompanionThreadInterruptedRow(
  previous: TimelineRow,
  row: TimelineRow,
): boolean {
  return (
    isErrorSystemRow(previous) &&
    isThreadInterruptedOperationRow(row) &&
    previous.threadId === row.threadId &&
    previous.createdAt === row.createdAt &&
    previous.startedAt === row.startedAt &&
    previous.sourceSeqEnd + 1 === row.sourceSeqStart
  );
}

function appendRows(target: TimelineRow[], rows: readonly TimelineRow[]): void {
  for (const row of rows) {
    const previous = target[target.length - 1];
    if (
      previous &&
      isReconnectSystemRow(previous) &&
      isReconnectSystemRow(row)
    ) {
      // Reconnect attempts are one transient status, so update the progress row
      // in place instead of flooding the timeline with every retry attempt.
      target[target.length - 1] = row;
      continue;
    }
    if (previous && isCompanionThreadInterruptedRow(previous, row)) {
      continue;
    }
    target.push(row);
  }
}

function getTimelineMessageBounds(
  messages: readonly EventProjectionMessage[],
): TimelineMessageBounds {
  const firstMessage = messages[0];
  if (!firstMessage) {
    throw new Error("Cannot build timeline bounds from an empty message list");
  }

  let sourceSeqStart = firstMessage.sourceSeqStart;
  let sourceSeqEnd = firstMessage.sourceSeqEnd;
  let startedAt = getMessageStartedAt(firstMessage);
  let createdAt = firstMessage.createdAt;

  for (const message of messages.slice(1)) {
    sourceSeqStart = Math.min(sourceSeqStart, message.sourceSeqStart);
    sourceSeqEnd = Math.max(sourceSeqEnd, message.sourceSeqEnd);
    startedAt = Math.min(startedAt, getMessageStartedAt(message));
    createdAt = Math.min(createdAt, message.createdAt);
  }

  return {
    createdAt,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
  };
}

function getTimelineMessageCompletedAt(
  messages: readonly EventProjectionMessage[],
): number | null {
  if (messages.length === 0) {
    return null;
  }
  let completedAt = messages[0].createdAt;
  for (const message of messages.slice(1)) {
    completedAt = Math.max(completedAt, message.createdAt);
  }
  return completedAt;
}

function getTurnBounds(turn: EventProjectionTurn): TimelineMessageBounds {
  return {
    createdAt: turn.createdAt,
    sourceSeqEnd: turn.sourceSeqEnd,
    sourceSeqStart: turn.sourceSeqStart,
    startedAt: turn.startedAt,
  };
}

function buildTurnSummaryRow({
  completedAt,
  includeNestedRows,
  rowIdPrefix,
  segmentIndex,
  sourceMessages,
  sourceRows,
  startedAt,
  summaryCount,
  turn,
}: BuildTurnSummaryRowArgs): TimelineTurnRow | null {
  if (summaryCount === 0 && sourceRows.length === 0) {
    return null;
  }

  const bounds =
    segmentIndex === null || sourceMessages.length === 0
      ? getTurnBounds(turn)
      : getTimelineMessageBounds(sourceMessages);
  const rowId =
    segmentIndex === null
      ? `${rowIdPrefix}${turn.threadId}:${turn.turnId}:turn`
      : `${rowIdPrefix}${turn.threadId}:${turn.turnId}:turn:${segmentIndex}`;
  const resolvedCompletedAt =
    completedAt ?? getTimelineMessageCompletedAt(sourceMessages);

  return {
    id: rowId,
    threadId: turn.threadId,
    turnId: turn.turnId,
    sourceSeqStart: bounds.sourceSeqStart,
    sourceSeqEnd: bounds.sourceSeqEnd,
    startedAt,
    createdAt: bounds.createdAt,
    kind: "turn",
    status: turn.status,
    summaryCount,
    completedAt: resolvedCompletedAt,
    children: includeNestedRows ? sourceRows : null,
  };
}

function buildCompletedTurnSummaryRows({
  delegationChildRows,
  includeNestedRows,
  rowIdPrefix,
  summaryItems,
  turn,
  workspaceRoot,
}: BuildCompletedTurnSummaryRowsArgs): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const item of summaryItems) {
    if (item.kind === "ungrouped-message") {
      rows.push(
        ...convertMessage(item.message, {
          delegationChildRows,
          includeNestedRows,
          rowIdPrefix,
          workspaceRoot,
        }),
      );
      continue;
    }

    const sourceRows = includeNestedRows
      ? item.sourceMessages.flatMap((message) =>
          convertMessage(message, {
            delegationChildRows,
            includeNestedRows,
            rowIdPrefix,
            workspaceRoot,
          }),
        )
      : [];
    const turnRow = buildTurnSummaryRow({
      completedAt: item.completedAt,
      includeNestedRows,
      rowIdPrefix,
      segmentIndex: item.segmentIndex,
      sourceMessages: item.sourceMessages,
      sourceRows,
      startedAt: item.startedAt,
      summaryCount: item.summaryCount,
      turn,
    });
    if (turnRow) {
      rows.push(turnRow);
    }
  }
  return rows;
}

function buildTurnRows({
  delegationChildRows,
  includeNestedRows,
  rowIdPrefix,
  turn,
  workspaceRoot,
}: BuildTurnRowsArgs): TimelineRow[] {
  const messages = turn.messages ?? [];
  const isCompletedTurn =
    turn.status !== "pending" && turn.completedAt !== null;

  if (!isCompletedTurn) {
    return messages.flatMap((message) =>
      convertMessage(message, {
        delegationChildRows,
        includeNestedRows,
        rowIdPrefix,
        workspaceRoot,
      }),
    );
  }

  const { summaryItems, terminalMessages, trailingMessages } =
    groupCompletedTurnMessages(turn);
  const terminalRows = terminalMessages.flatMap((message) =>
    convertMessage(message, {
      delegationChildRows,
      includeNestedRows,
      rowIdPrefix,
      workspaceRoot,
    }),
  );
  const trailingRows = trailingMessages.flatMap((message) =>
    convertMessage(message, {
      delegationChildRows,
      includeNestedRows,
      rowIdPrefix,
      workspaceRoot,
    }),
  );
  const summaryRows = buildCompletedTurnSummaryRows({
    delegationChildRows,
    includeNestedRows,
    rowIdPrefix,
    summaryItems,
    turn,
    workspaceRoot,
  });
  return [...summaryRows, ...terminalRows, ...trailingRows];
}

type TimelineTurnSummaryRow = Extract<TimelineRow, { kind: "turn" }>;

interface TimelineTurnSummaryMatch {
  overlapSize: number;
  row: TimelineTurnSummaryRow;
}

function timelineRangeOverlapSize(
  left: ThreadTimelineSourceSeqRange,
  right: ThreadTimelineSourceSeqRange,
): number {
  const start = Math.max(left.sourceSeqStart, right.sourceSeqStart);
  const end = Math.min(left.sourceSeqEnd, right.sourceSeqEnd);
  return Math.max(0, end - start + 1);
}

function findMatchingTurnSummaryRow(
  rows: TimelineRow[],
  options: BuildThreadTimelineTurnDetailsFromEventsOptions,
): TimelineTurnSummaryRow | null {
  let bestOverlap: TimelineTurnSummaryMatch | null = null;
  for (const row of rows) {
    if (row.kind !== "turn" || row.turnId !== options.turnId) {
      continue;
    }
    if (
      row.sourceSeqStart === options.sourceSeqStart &&
      row.sourceSeqEnd === options.sourceSeqEnd
    ) {
      return row;
    }
    const overlapSize = timelineRangeOverlapSize(row, options);
    if (
      overlapSize > 0 &&
      (bestOverlap === null || overlapSize > bestOverlap.overlapSize)
    ) {
      bestOverlap = { overlapSize, row };
    }
  }
  return bestOverlap?.row ?? null;
}

function hasTurnSummaryRows(rows: TimelineRow[]): boolean {
  return rows.some((row) => row.kind === "turn");
}

function buildTimelineRows(
  projection: EventProjection,
  options: BuildTimelineRowsOptions,
): TimelineRow[] {
  const { includeNestedRows } = options;
  const rows: TimelineRow[] = [];

  for (const entry of projection.entries) {
    switch (entry.kind) {
      case "projected-message":
        appendRows(rows, convertMessage(entry.message, options));
        break;
      case "turn":
        appendRows(
          rows,
          buildTurnRows({
            delegationChildRows: options.delegationChildRows,
            turn: entry.turn,
            includeNestedRows,
            rowIdPrefix: options.rowIdPrefix,
            workspaceRoot: options.workspaceRoot,
          }),
        );
        break;
      default:
        assertNever(entry);
    }
  }

  return rows;
}

export function buildThreadTimelineFromEvents(
  args: BuildThreadTimelineFromEventsArgs,
): ThreadTimelineFromEventsResult {
  const projectionOptions = {
    acceptedClientRequestContext: args.acceptedClientRequestContext,
    includeDebugRawEvents: args.options.includeDebugRawEvents,
    includeProviderUnhandledOperations:
      args.options.includeProviderUnhandledOperations,
    threadStatus: args.options.threadStatus,
    turnMessageDetail: args.options.turnMessageDetail,
  } satisfies Parameters<typeof buildEventProjection>[1];
  const projection = buildEventProjection(args.events, projectionOptions);

  const rows = [
    ...buildTimelineRows(projection, {
      delegationChildRows: "all",
      includeNestedRows: args.options.includeNestedRows,
      rowIdPrefix: ROOT_TIMELINE_ROW_ID_PREFIX,
      workspaceRoot: args.options.workspaceRoot,
    }),
    ...buildPendingSteerRowsFromEvents(
      args.acceptedClientRequestContext,
      args.events,
      args.options,
    ),
  ];

  return {
    activeThinking: projection.state.activeThinking,
    contextWindowUsage: extractThreadContextWindowUsage(
      args.contextWindowEvents,
    ),
    pendingTodos: !args.options.isLatestPage
      ? null
      : extractThreadTimelinePendingTodos(
          args.options.threadStatus,
          args.events,
        ),
    rows,
  };
}

export function buildThreadTimelineFeedFromEvents(
  args: BuildThreadTimelineFeedFromEventsArgs,
): ThreadTimelineFeedFromEventsResult {
  const projection = buildEventProjection(args.events, {
    acceptedClientRequestContext: args.acceptedClientRequestContext,
    includeDebugRawEvents: args.options.includeDebugRawEvents,
    includeProviderUnhandledOperations:
      args.options.includeProviderUnhandledOperations,
    threadStatus: args.options.threadStatus,
    turnMessageDetail: "summary",
  });
  const rows = [
    ...buildTimelineRows(projection, {
      delegationChildRows: "pending-only",
      includeNestedRows: false,
      rowIdPrefix: ROOT_TIMELINE_ROW_ID_PREFIX,
      workspaceRoot: args.options.workspaceRoot,
    }),
    ...buildPendingSteerRowsFromEvents(
      args.acceptedClientRequestContext,
      args.events,
      args.options,
    ),
  ];
  const paginatedTimeline = tryPaginateTimelineRows({
    page: args.options.paginationPage,
    rows,
  });
  if (paginatedTimeline.kind === "missing-cursor") {
    return {
      kind: "missing-cursor",
    };
  }

  const responseRows = args.options.summaryOnly
    ? []
    : paginatedTimeline.page.rows;

  return {
    activeThinking: args.options.isLatestPage
      ? projection.state.activeThinking
      : null,
    contextWindowUsage: args.options.isLatestPage
      ? (extractThreadContextWindowUsage(args.contextWindowEvents) ??
        undefined)
      : undefined,
    kind: "success",
    pendingTodos: !args.options.isLatestPage
      ? null
      : extractThreadTimelinePendingTodos(
          args.options.threadStatus,
          args.events,
        ),
    projectedRowCount: rows.length,
    responseRowCount: paginatedTimeline.page.rows.length,
    rows: buildTimelineFeedRows({
      fileDiffLookup: args.options.fileDiffLookupForRows(responseRows),
      rowKeyForRow: args.options.rowKeyForRow,
      rows: responseRows,
    }),
    timelinePage: {
      kind: args.options.responsePageKind,
      segmentLimit: paginatedTimeline.page.segmentLimit,
      returnedSegmentCount: paginatedTimeline.page.returnedSegmentCount,
      hasOlderRows: paginatedTimeline.page.hasOlderRows,
      olderCursor: paginatedTimeline.page.olderCursor,
    },
  };
}

export function buildThreadTimelineTurnDetailsFromEvents(
  args: BuildThreadTimelineTurnDetailsFromEventsArgs,
): ThreadTimelineTurnDetailsFromEventsResult {
  const projection = buildEventProjectionEntries(args.events, {
    includeDebugRawEvents: false,
    includeProviderUnhandledOperations:
      args.options.includeProviderUnhandledOperations,
    threadStatus: args.options.threadStatus,
    turnMessageDetail: "full",
  });
  const nestedRows = buildTimelineRows(projection, {
    delegationChildRows: "all",
    includeNestedRows: true,
    rowIdPrefix: ROOT_TIMELINE_ROW_ID_PREFIX,
    workspaceRoot: args.options.workspaceRoot,
  });
  const matchingTurnSummary = findMatchingTurnSummaryRow(
    nestedRows,
    args.options,
  );
  if (matchingTurnSummary) {
    return {
      kind: "matched",
      rows: matchingTurnSummary.children ?? [],
    };
  }

  if (hasTurnSummaryRows(nestedRows)) {
    return {
      kind: "missing-match",
    };
  }

  return {
    kind: "ungrouped",
    rows: nestedRows,
  };
}
