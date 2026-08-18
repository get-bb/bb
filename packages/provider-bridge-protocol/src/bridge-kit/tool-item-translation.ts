import type { ThreadEventItem, ThreadEventItemStatus } from "@bb/domain";
import {
  buildEditDiff,
  toOptionalRecord,
  withParentToolCallId,
} from "./adapter-utils.js";

type FileChangeItem = Extract<ThreadEventItem, { type: "fileChange" }>;
type ToolCallItem = Extract<ThreadEventItem, { type: "toolCall" }>;

/**
 * The generic pending `toolCall` item a provider falls back to when a tool
 * use has no richer translation (unknown tool, or a known tool whose
 * arguments failed to parse). Raw arguments are attached when they are a
 * record.
 */
export function buildGenericToolCallItem(args: {
  args: unknown;
  callId: string;
  toolName: string;
}): ToolCallItem {
  const toolArguments = toOptionalRecord(args.args);
  return {
    type: "toolCall",
    id: args.callId,
    tool: args.toolName,
    ...(toolArguments ? { arguments: toolArguments } : {}),
    status: "pending",
  };
}

export function buildFileChangeItem(args: {
  callId: string;
  newText?: string;
  oldText?: string;
  path: string;
}): FileChangeItem {
  const diff = buildEditDiff(args.path, args.oldText, args.newText);
  return {
    type: "fileChange",
    id: args.callId,
    changes: [
      {
        path: args.path,
        kind: args.oldText === undefined ? "add" : "update",
        ...(diff ? { diff } : {}),
      },
    ],
    status: "pending",
    approvalStatus: null,
  };
}

export interface CompleteStartedToolItemArgs {
  callId: string;
  commandOutputText?: string;
  exitCode?: number;
  outputText?: string;
  parentToolCallId?: string;
  startedItem: ThreadEventItem;
  status: ThreadEventItemStatus;
  toolCallResult?: unknown;
}

export function completeStartedToolItem(
  args: CompleteStartedToolItemArgs,
): ThreadEventItem | null {
  return completeStartedToolItemInternal(args, false);
}

/**
 * `preserveUndefinedToolCallFields` keeps explicit `undefined` values on the
 * completed toolCall's `arguments`/`result` keys, matching the historical
 * result-item shape `buildToolResultItem` has always emitted.
 */
function completeStartedToolItemInternal(
  args: CompleteStartedToolItemArgs,
  preserveUndefinedToolCallFields: boolean,
): ThreadEventItem | null {
  const parentToolCallId =
    args.parentToolCallId ?? args.startedItem.parentToolCallId;
  const withParent = (item: ThreadEventItem): ThreadEventItem =>
    withParentToolCallId(item, parentToolCallId);

  switch (args.startedItem.type) {
    case "commandExecution":
      return withParent({
        type: "commandExecution",
        id: args.callId,
        command: args.startedItem.command,
        cwd: args.startedItem.cwd,
        ...(args.commandOutputText === undefined
          ? {}
          : { aggregatedOutput: args.commandOutputText }),
        ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
        status: args.status,
        approvalStatus: args.startedItem.approvalStatus,
      });
    case "fileChange":
      return withParent({
        type: "fileChange",
        id: args.callId,
        changes: args.startedItem.changes,
        status: args.status,
        approvalStatus: args.startedItem.approvalStatus,
      });
    case "webSearch":
      return withParent({
        type: "webSearch",
        id: args.callId,
        queries: args.startedItem.queries,
        resultText: args.outputText ?? null,
      });
    case "webFetch":
      return withParent({
        type: "webFetch",
        id: args.callId,
        url: args.startedItem.url,
        prompt: args.startedItem.prompt,
        pattern: args.startedItem.pattern,
        resultText: args.outputText ?? null,
      });
    case "toolCall":
      return withParent({
        type: "toolCall",
        id: args.callId,
        tool: args.startedItem.tool,
        ...(preserveUndefinedToolCallFields ||
        args.startedItem.arguments !== undefined
          ? { arguments: args.startedItem.arguments }
          : {}),
        status: args.status,
        ...(preserveUndefinedToolCallFields ||
        args.toolCallResult !== undefined
          ? { result: args.toolCallResult }
          : {}),
      });
    default:
      return null;
  }
}

export function buildToolResultItem(args: {
  callId: string;
  commandOutputText?: string;
  commandToolNames: ReadonlySet<string>;
  fileChangeToolNames: ReadonlySet<string>;
  isError: boolean;
  outputText?: string;
  parentToolCallId?: string;
  startedItem?: ThreadEventItem;
  toolCallResult?: unknown;
  toolName?: string;
}): ThreadEventItem {
  const status = args.isError ? "failed" : "completed";
  const exitCode = args.isError ? 1 : 0;
  // Web items are never completed here: a provider that wants a started
  // webSearch/webFetch item finished calls completeStartedToolItem itself.
  if (
    args.startedItem &&
    args.startedItem.type !== "webSearch" &&
    args.startedItem.type !== "webFetch"
  ) {
    const completed = completeStartedToolItemInternal(
      {
        callId: args.callId,
        commandOutputText: args.commandOutputText,
        exitCode,
        outputText: args.outputText,
        parentToolCallId: args.parentToolCallId,
        startedItem: args.startedItem,
        status,
        toolCallResult: args.toolCallResult,
      },
      true,
    );
    if (completed) {
      return completed;
    }
  }

  if (args.toolName && args.commandToolNames.has(args.toolName)) {
    return withParentToolCallId(
      {
        type: "commandExecution",
        id: args.callId,
        command: "",
        cwd: "",
        ...(args.commandOutputText === undefined
          ? {}
          : { aggregatedOutput: args.commandOutputText }),
        exitCode,
        status,
        approvalStatus: null,
      },
      args.parentToolCallId,
    );
  }
  if (args.toolName && args.fileChangeToolNames.has(args.toolName)) {
    return withParentToolCallId(
      {
        type: "fileChange",
        id: args.callId,
        changes: [],
        status,
        approvalStatus: null,
      },
      args.parentToolCallId,
    );
  }
  return withParentToolCallId(
    {
      type: "toolCall",
      id: args.callId,
      tool: args.toolName ?? "unknown",
      status,
      result: args.toolCallResult,
    },
    args.parentToolCallId,
  );
}
