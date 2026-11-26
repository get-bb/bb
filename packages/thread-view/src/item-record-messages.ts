import {
  jsonValueSchema,
  type ActiveThinking,
  type JsonObject,
  type ThreadEventItem,
  type ThreadEventItemApprovalStatus,
  type ThreadEventItemStatus,
} from "@bb/domain";
import type { EventProjection } from "./event-projection.js";
import type {
  EventProjectionApprovalLifecycleStatus,
  EventProjectionAssistantTextMessage,
  EventProjectionFileEditMessage,
  EventProjectionMessage,
  EventProjectionOperationMessage,
  EventProjectionToolCallMessage,
} from "./event-projection-types.js";
import { durationToCompactString, messageId } from "./format-helpers.js";
import type {
  ItemRecord,
  ItemRecordPoint,
  ItemRecordStore,
} from "./item-records.js";
import {
  eventProjectionMessageThreadScopeFields,
  eventProjectionMessageTurnScopeFields,
} from "./message-scope.js";
import {
  extractShellCommandFromString,
  parseShellCommandIntents,
} from "./tool-call-parsing.js";
import { sliceUtf16Head } from "@bb/text-utils";

type CallStatus = EventProjectionToolCallMessage["status"];

const DELEGATION_ITEM_TOOL_NAME = "delegation";
const MAX_REASONING_DETAIL_CHARS = 32_000;

function itemStatusToExecStatus(status: ThreadEventItemStatus): CallStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "interrupted":
      return "interrupted";
  }
}

function itemStatusToApprovalStatus(
  status: ThreadEventItemApprovalStatus,
): EventProjectionApprovalLifecycleStatus | null {
  return status === "waiting_for_approval" || status === "denied"
    ? status
    : null;
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

function scopeFields(record: ItemRecord) {
  return record.turnId
    ? eventProjectionMessageTurnScopeFields(record.turnId)
    : eventProjectionMessageThreadScopeFields();
}

function parentFields(parentToolCallId: string | undefined) {
  return parentToolCallId ? { parentToolCallId } : {};
}

function baseFields(
  record: ItemRecord,
  id: string,
  start: ItemRecordPoint,
  end: ItemRecordPoint,
  parentToolCallId: string | undefined = record.parentToolCallId,
) {
  return {
    id,
    threadId: record.threadId,
    sourceEvent: { seq: start.seq, part: 0 },
    sourceSeqStart: start.seq,
    sourceSeqEnd: end.seq,
    createdAt: end.createdAt,
    startedAt: start === record.start ? record.startedAt : start.createdAt,
    ...scopeFields(record),
    ...parentFields(parentToolCallId),
  };
}

function presentationOf(record: ItemRecord, item: ThreadEventItem) {
  const presentation =
    ("presentation" in item ? item.presentation : undefined) ??
    record.firstPresentation;
  return presentation ? { presentation } : {};
}

function toolCallName(
  item: Extract<ThreadEventItem, { type: "toolCall" }>,
): string {
  return `${item.server ? `${item.server}:` : ""}${item.tool}`;
}

function toolArgs(
  args: Record<string, unknown> | undefined,
): JsonObject | null {
  if (!args) return null;
  const parsed: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    parsed[key] = jsonValueSchema.parse(value);
  }
  return parsed;
}

function visibleRunningOutput(record: ItemRecord, settled: boolean): string {
  if (record.finished || settled) return record.output;
  const visible = Math.max(
    record.flushedOutputLength,
    record.output.lastIndexOf("\n") + 1,
  );
  return record.output.slice(0, visible);
}

function visibleStreamingText(text: string): string {
  return text.slice(0, text.lastIndexOf("\n") + 1);
}

function assistantRecordMessage(
  record: ItemRecord,
  key: string,
  settleStreaming: boolean,
): EventProjectionAssistantTextMessage | null {
  const item = record.item;
  const finalText =
    record.finished && (item?.type === "agentMessage" || item?.type === "plan")
      ? item.text
      : "";
  const settled = record.finished || record.stop !== null || settleStreaming;
  const text =
    finalText.length > 0
      ? finalText
      : settled
        ? record.text
        : visibleStreamingText(record.text);
  if (!record.textStart || !record.textEnd || text.length === 0) return null;
  return {
    kind: "assistant-text",
    ...baseFields(
      record,
      messageId(record.threadId, "assistant", key),
      record.textStart,
      record.textEnd,
    ),
    text,
    status: settled ? "completed" : "streaming",
  };
}

function normalizeReasoningDetail(detail: string): string {
  const trimmed = detail.trim();
  if (trimmed.length <= MAX_REASONING_DETAIL_CHARS) return trimmed;
  const dropped = trimmed.length - MAX_REASONING_DETAIL_CHARS;
  return `${sliceUtf16Head(trimmed, MAX_REASONING_DETAIL_CHARS)}\n…[${dropped.toLocaleString("en-US")} more characters truncated]`;
}

function reasoningFinalText(item: ThreadEventItem | null): string {
  return item?.type === "reasoning"
    ? `${item.summary.join("")}${item.content.join("")}`
    : "";
}

function reasoningRecordMessage(
  record: ItemRecord,
  key: string,
): EventProjectionOperationMessage | null {
  const end = record.stop ?? (record.finished ? record.completion : null);
  if (!end) return null;
  const item = record.completion ? record.item : null;
  const keepsStreamedOrder =
    item?.type === "reasoning" &&
    record.text.length > 0 &&
    item.summary.join("") === record.reasoningSummary &&
    item.content.join("") === record.reasoningContent;
  const finalText = keepsStreamedOrder ? "" : reasoningFinalText(item);
  const detail = finalText.trim().length > 0 ? finalText : record.text;
  if (detail.trim().length === 0) return null;
  const durationMs = end.createdAt - record.start.createdAt;
  return {
    kind: "operation",
    ...baseFields(
      record,
      messageId(record.threadId, "op", `reasoning:${key}`),
      record.start,
      end,
    ),
    sourceSeqEnd: record.completion?.seq ?? end.seq,
    completedAt: end.createdAt,
    opType: "reasoning",
    title:
      durationMs > 0
        ? `Thought for ${durationToCompactString(durationMs)}`
        : "Thought",
    detail: normalizeReasoningDetail(detail),
    status: record.stop?.interrupted === true ? "interrupted" : "completed",
  };
}

export function selectItemRecordActiveThinking(
  store: ItemRecordStore,
): ActiveThinking | null {
  let latest: ItemRecord | null = null;
  for (const record of store.openText) {
    if (
      record.textKind === "reasoning" &&
      (latest === null || record.end.seq >= latest.end.seq)
    ) {
      latest = record;
    }
  }
  if (latest === null || latest.textKey === null) return null;
  return {
    id: messageId(latest.threadId, "op", `reasoning:${latest.textKey}`),
    text: visibleStreamingText(latest.text).trim(),
    startedAt: latest.start.createdAt,
    updatedAt: latest.end.createdAt,
  };
}

function formatItemRecord(
  record: ItemRecord,
  settled: boolean,
): EventProjectionMessage[] {
  if (record.dropped) return [];
  const message =
    record.textKind === null || record.textKey === null
      ? null
      : record.textKind === "assistant"
        ? assistantRecordMessage(record, record.textKey, settled)
        : reasoningRecordMessage(record, record.textKey);
  if (record.textKind !== null) return message ? [message] : [];
  return itemRecordMessages(record, settled);
}

export function collectItemRecordMessages(
  store: ItemRecordStore,
  settled: boolean,
): EventProjectionMessage[] {
  const messages: EventProjectionMessage[] = [];
  for (const record of store.records) {
    let formatted = record.formatted;
    if (
      formatted === null ||
      formatted.version !== record.version ||
      formatted.settled !== settled
    ) {
      formatted = {
        version: record.version,
        settled,
        messages: formatItemRecord(record, settled),
      };
      record.formatted = formatted;
    }
    messages.push(...formatted.messages);
  }
  return messages;
}

function fileEditMessages(
  record: ItemRecord,
  item: Extract<ThreadEventItem, { type: "fileChange" }> | null,
  settled: boolean,
): EventProjectionFileEditMessage[] {
  const stdout = visibleRunningOutput(record, settled);
  const emptyKey = `${record.itemId}:0`;
  const entries =
    item !== null && item.changes.length > 0
      ? item.changes.map((change, index) => {
          const row = record.fileRows[record.fileRowIndexes[index] ?? -1];
          return {
            change: {
              path: change.path,
              kind: change.kind,
              movePath: change.movePath ?? null,
              diff: change.diff,
            },
            key:
              row?.key ?? `${record.itemId}:${change.movePath ?? change.path}`,
            start: row?.start ?? record.start,
          };
        })
      : [
          {
            change: null,
            key: record.foreignFileKeys.has(emptyKey)
              ? `${record.turnId ?? "thread"}:${emptyKey}`
              : emptyKey,
            start: record.start,
          },
        ];
  return entries.map(({ change, key, start }, part) => ({
    kind: "file-edit",
    ...baseFields(
      record,
      messageId(record.threadId, "file-edit", key),
      start,
      record.end,
    ),
    sourceEvent: { seq: start.seq, part },
    ...(item ? presentationOf(record, item) : {}),
    callId: record.itemId,
    changes: change ? [change] : [],
    stdout: stdout.length > 0 ? stdout : undefined,
    stderr: item?.error,
    approvalStatus: item
      ? itemStatusToApprovalStatus(item.approvalStatus)
      : null,
    status: item ? itemStatusToExecStatus(item.status) : "pending",
  }));
}

function activityStatus(
  record: ItemRecord,
  status: ThreadEventItemStatus,
): "pending" | "completed" | "error" | "interrupted" {
  if (!record.finished) return "pending";
  const mapped = itemStatusToExecStatus(status);
  return mapped === "pending" ? "completed" : mapped;
}

function itemRecordMessages(
  record: ItemRecord,
  settled: boolean,
): EventProjectionMessage[] {
  const item = record.item;
  if (item === null) {
    return record.outputKind === "file-change"
      ? fileEditMessages(record, null, settled)
      : [];
  }
  const completedAt =
    record.finished && record.completion ? record.completion.createdAt : null;
  const call = (kind: string) => ({
    ...baseFields(
      record,
      messageId(record.threadId, kind, record.itemId),
      record.start,
      record.end,
    ),
    ...presentationOf(record, item),
    callId: record.itemId,
    completedAt,
  });
  switch (item.type) {
    case "commandExecution": {
      const command = extractShellCommandFromString(item.command);
      return [
        {
          kind: "command",
          ...call("command"),
          command: command ?? "",
          description: record.description,
          cwd: item.cwd,
          parsedIntents: parseShellCommandIntents(command),
          source: null,
          output:
            ((record.finished ? item.aggregatedOutput : undefined) ??
              visibleRunningOutput(record, settled)) + record.lateOutput,
          exitCode: item.exitCode ?? null,
          approvalStatus: itemStatusToApprovalStatus(item.approvalStatus),
          status:
            item.exitCode !== undefined && item.exitCode !== 0
              ? "error"
              : itemStatusToExecStatus(item.status),
        },
      ];
    }
    case "toolCall": {
      const result = item.result;
      const output =
        typeof result === "string"
          ? result
          : result !== undefined
            ? JSON.stringify(result)
            : undefined;
      return [
        {
          kind: "tool-call",
          ...call("tool"),
          toolName: toolCallName(
            record.firstItem?.type === "toolCall" ? record.firstItem : item,
          ),
          toolArgs: toolArgs(
            (record.firstItem?.type === "toolCall"
              ? record.firstItem.arguments
              : undefined) ?? item.arguments,
          ),
          output: record.finished
            ? (output ?? item.error ?? "")
            : (record.progress ?? ""),
          approvalStatus: null,
          status: record.finished
            ? itemStatusToExecStatus(item.status)
            : "pending",
        },
      ];
    }
    case "delegation":
      return [
        {
          kind: "delegation",
          ...call("delegation"),
          toolName: DELEGATION_ITEM_TOOL_NAME,
          childRef: item.childRef,
          background: item.background,
          description: item.label,
          output: item.summary ?? "",
          status: record.finished
            ? itemStatusToExecStatus(item.status)
            : "pending",
          childProjection: emptyEventProjection(),
        },
      ];
    case "fileChange":
      return fileEditMessages(record, item, settled);
    case "webSearch":
    case "webFetch":
    case "imageView":
    case "imageGeneration":
    case "fileRead":
    case "search":
    case "planSteps":
    case "extension": {
      const activity = {
        ...call(activityKind(item.type)),
        id: messageId(
          record.threadId,
          activityKind(item.type),
          record.hasStartedEvent || !record.completion
            ? record.itemId
            : `${record.itemId}:${record.completion.seq}`,
        ),
        completedAt:
          record.finished && record.completion
            ? record.completion.createdAt
            : null,
      };
      switch (item.type) {
        case "webSearch":
          return [
            {
              ...activity,
              kind: "web-search",
              queries: item.queries,
              status: record.finished ? "completed" : "pending",
            },
          ];
        case "webFetch":
          return [
            {
              ...activity,
              kind: "web-fetch",
              url: item.url,
              prompt: item.prompt,
              pattern: item.pattern,
              status: record.finished ? "completed" : "pending",
            },
          ];
        case "imageView":
          return [
            {
              ...activity,
              kind: "image-view",
              path: item.path,
              status: record.finished ? "completed" : "pending",
            },
          ];
        case "imageGeneration":
          return [
            {
              ...activity,
              kind: "image-generation",
              prompt: item.prompt,
              path: item.path,
              error: item.error,
              transparentBackground: item.transparentBackground,
              status: activityStatus(record, item.status),
            },
          ];
        case "fileRead":
          return [
            {
              ...activity,
              kind: "file-read",
              path: item.path,
              cmd: item.cmd ?? null,
              status: activityStatus(record, item.status),
            },
          ];
        case "search":
          return [
            {
              ...activity,
              kind: "search",
              mode: item.mode,
              query: item.query,
              path: item.path ?? null,
              cmd: item.cmd ?? null,
              status: activityStatus(record, item.status),
            },
          ];
        case "planSteps":
          return [
            {
              ...activity,
              kind: "plan-steps",
              steps: item.steps,
              explanation: item.explanation ?? null,
              status: activityStatus(record, item.status),
            },
          ];
        case "extension":
          return [
            {
              ...activity,
              kind: "extension",
              extensionKind: item.kind,
              payload: item.payload,
              presentation: item.presentation,
              status: activityStatus(record, item.status),
            },
          ];
      }
      return [];
    }
    case "backgroundTask":
      return [
        {
          kind: "workflow",
          ...baseFields(
            record,
            item.id,
            record.start,
            record.start,
            record.firstItem?.type === "backgroundTask"
              ? record.firstItem.parentToolCallId
              : item.parentToolCallId,
          ),
          createdAt: record.end.createdAt,
          ...(record.firstPresentation
            ? { presentation: record.firstPresentation }
            : {}),
          itemId: item.id,
          familyId: item.familyId ?? null,
          taskType: item.taskType,
          workflowName: item.workflowName ?? null,
          description: item.description,
          model: null,
          status: itemStatusToExecStatus(item.status),
          taskStatus: item.taskStatus,
          stoppable: item.stoppable === true,
          skipTranscript: item.skipTranscript,
          foreground: item.foreground,
          workflow: item.workflow ?? null,
          usage: item.usage ?? null,
          summary: item.summary ?? null,
          error: item.error ?? null,
          completedAt: record.completion?.createdAt ?? null,
        },
      ];
    case "agentMessage":
    case "plan":
    case "reasoning":
    case "contextCompaction":
    case "userMessage":
      return [];
  }
}

function activityKind(
  type:
    | "webSearch"
    | "webFetch"
    | "imageView"
    | "imageGeneration"
    | "fileRead"
    | "search"
    | "planSteps"
    | "extension",
) {
  switch (type) {
    case "webSearch":
      return "web-search";
    case "webFetch":
      return "web-fetch";
    case "imageView":
      return "image-view";
    case "imageGeneration":
      return "image-generation";
    case "fileRead":
      return "file-read";
    case "search":
      return "search";
    case "planSteps":
      return "plan-steps";
    case "extension":
      return "extension";
  }
}
