import type { ThreadEventItem, ThreadEventItemStatus } from "@bb/domain";
import {
  buildEditDiff,
  toOptionalRecord,
  withParentToolCallId,
} from "./adapter-utils.js";

type FileChangeItem = Extract<ThreadEventItem, { type: "fileChange" }>;

export interface ToolUseTranslationInput {
  args: unknown;
  callId: string;
  parentToolCallId?: string;
  toolName: string;
}

export interface ParsedCommandToolArguments {
  command: string;
  cwd: string;
}

export interface ParsedFileChangeToolArguments {
  arguments: Record<string, unknown>;
  newText?: string;
  oldText?: string;
  path?: string;
}

export interface BuildToolUseItemOptions {
  commandToolNames: ReadonlySet<string>;
  fileChangeToolNames: ReadonlySet<string>;
  parseCommand: (args: unknown) => ParsedCommandToolArguments | null;
  parseFileChange: (args: unknown) => ParsedFileChangeToolArguments | null;
  translateSpecialToolUse?: (
    input: ToolUseTranslationInput,
  ) => ThreadEventItem | null;
}

export function buildFileChangeItem(args: {
  newText?: string;
  oldText?: string;
  path: string;
}): FileChangeItem {
  const diff = buildEditDiff(args.path, args.oldText, args.newText);
  return {
    type: "fileChange",
    id: "",
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

export function buildToolUseItem(
  input: ToolUseTranslationInput,
  options: BuildToolUseItemOptions,
): ThreadEventItem {
  const toolArguments = toOptionalRecord(input.args);
  const baseToolCall = {
    type: "toolCall" as const,
    id: input.callId,
    tool: input.toolName,
    ...(toolArguments ? { arguments: toolArguments } : {}),
    status: "pending" as const,
  };
  const withParent = (item: ThreadEventItem): ThreadEventItem =>
    withParentToolCallId(item, input.parentToolCallId);

  if (options.commandToolNames.has(input.toolName)) {
    const command = options.parseCommand(input.args);
    return command
      ? withParent({
          type: "commandExecution",
          id: input.callId,
          command: command.command,
          cwd: command.cwd,
          status: "pending",
          approvalStatus: null,
        })
      : withParent(baseToolCall);
  }

  if (options.fileChangeToolNames.has(input.toolName)) {
    const parsed = options.parseFileChange(input.args);
    if (!parsed) {
      return withParent(baseToolCall);
    }
    if (!parsed.path) {
      return withParent({ ...baseToolCall, arguments: parsed.arguments });
    }
    return withParent({
      ...buildFileChangeItem({
        path: parsed.path,
        oldText: parsed.oldText,
        newText: parsed.newText,
      }),
      id: input.callId,
    });
  }

  return withParent(options.translateSpecialToolUse?.(input) ?? baseToolCall);
}

export interface CompleteStartedToolItemArgs {
  callId: string;
  commandOutputText?: string;
  exitCode?: number;
  outputText?: string;
  parentToolCallId?: string;
  preserveUndefinedToolCallFields?: boolean;
  startedItem: ThreadEventItem;
  status: ThreadEventItemStatus;
  toolCallResult?: unknown;
}

export function completeStartedToolItem(
  args: CompleteStartedToolItemArgs,
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
        ...(args.preserveUndefinedToolCallFields ||
        args.startedItem.arguments !== undefined
          ? { arguments: args.startedItem.arguments }
          : {}),
        status: args.status,
        ...(args.preserveUndefinedToolCallFields ||
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
  completeWebItems?: boolean;
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
  if (
    args.startedItem &&
    (args.completeWebItems ||
      (args.startedItem.type !== "webSearch" &&
        args.startedItem.type !== "webFetch"))
  ) {
    const completed = completeStartedToolItem({
      callId: args.callId,
      commandOutputText: args.commandOutputText,
      exitCode,
      outputText: args.outputText,
      parentToolCallId: args.parentToolCallId,
      preserveUndefinedToolCallFields: true,
      startedItem: args.startedItem,
      status,
      toolCallResult: args.toolCallResult,
    });
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
