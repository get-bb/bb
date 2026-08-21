import {
  jsonValueSchema,
  type JsonObject,
  ThreadEvent,
  ThreadEventItemApprovalStatus,
  ThreadEventItemStatus,
} from "@bb/domain";
import { getEventParentToolCallId, type EventMeta } from "./event-decode.js";
import type {
  EventProjectionApprovalLifecycleStatus,
  EventProjectionToolCallMessage,
  EventProjectionToolParsedIntent,
} from "./event-projection-types.js";
import { getFirstStringField } from "./format-helpers.js";
import {
  baseToolName,
  extractShellCommandFromString,
  formatToolCallCommand,
  isDelegationToolName,
  isStructuredListToolName,
  isStructuredReadToolName,
  isStructuredSearchToolName,
  parseShellCommandIntents,
  stripAgentOutputMetadata,
} from "./tool-call-parsing.js";

interface DelegationMetadata {
  subagentType?: string;
  description?: string;
  model?: string;
}

function parseToolArgs(
  args: Record<string, unknown> | null,
): JsonObject | null {
  if (!args) return null;
  const toolArgs: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    toolArgs[key] = jsonValueSchema.parse(value);
  }
  return toolArgs;
}

type ExecItemViewStatus = EventProjectionToolCallMessage["status"];

export function itemStatusToExecStatus(
  status: ThreadEventItemStatus,
): ExecItemViewStatus {
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

export function itemStatusToApprovalStatus(
  status: ThreadEventItemApprovalStatus,
): EventProjectionApprovalLifecycleStatus | null {
  switch (status) {
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "denied":
      return "denied";
    case null:
      return null;
  }
}

interface ExecutionUpdateBase {
  callId: string;
  output?: string;
  /**
   * Wall-clock millis when the work reached a terminal status. `null` while
   * pending. The projection records this on `end` events so the renderer
   * can derive duration from `(message.startedAt, completedAt)`.
   */
  completedAt: number | null;
  status?: EventProjectionToolCallMessage["status"];
  parentToolCallId?: string;
}

export interface CommandExecutionUpdate extends ExecutionUpdateBase {
  kind: "command";
  command?: string;
  cwd?: string | null;
  parsedIntents?: EventProjectionToolParsedIntent[];
  source?: string | null;
  exitCode?: number | null;
  approvalStatus?: EventProjectionApprovalLifecycleStatus | null;
}

export interface ToolCallExecutionUpdate extends ExecutionUpdateBase {
  kind: "tool-call";
  toolName?: string;
  toolArgs?: JsonObject | null;
  statusLabels?: { pending: string; completed: string };
  parsedIntents?: EventProjectionToolParsedIntent[];
  approvalStatus?: EventProjectionApprovalLifecycleStatus | null;
}

export interface DelegationExecutionUpdate
  extends ExecutionUpdateBase, DelegationMetadata {
  kind: "delegation";
  toolName?: string;
}

export type ProviderExecutionUpdate =
  | CommandExecutionUpdate
  | ToolCallExecutionUpdate
  | DelegationExecutionUpdate;

export interface ExecutionOutputUpdate {
  callId: string;
  output: string;
  status?: EventProjectionToolCallMessage["status"];
  parentToolCallId?: string;
}

type ExecLifecycleEvent =
  | {
      kind: "begin" | "end";
      call: ProviderExecutionUpdate;
    }
  | {
      kind: "output";
      output: ExecutionOutputUpdate;
      appendOutput?: boolean;
      replaceOutput?: boolean;
    };

function buildStructuredReadIntents(
  toolName: string,
  args: Record<string, unknown> | null,
): EventProjectionToolParsedIntent[] {
  const path = getFirstStringField(args, ["file_path", "file", "path"]);
  if (!path) {
    return [];
  }

  return [
    {
      type: "read",
      cmd: formatToolCallCommand(toolName, args),
      name: baseToolName(toolName),
      path,
    },
  ];
}

function buildStructuredSearchIntents(
  toolName: string,
  args: Record<string, unknown> | null,
): EventProjectionToolParsedIntent[] {
  const query = getFirstStringField(args, ["pattern", "query"]);
  if (!query) {
    return [];
  }

  return [
    {
      type: "search",
      cmd: formatToolCallCommand(toolName, args),
      query,
      path: getFirstStringField(args, ["path"]) ?? null,
    },
  ];
}

function buildStructuredListIntents(
  toolName: string,
  args: Record<string, unknown> | null,
): EventProjectionToolParsedIntent[] {
  const path = getFirstStringField(args, ["path", "pattern"]);
  if (!path) {
    return [];
  }

  return [
    {
      type: "list_files",
      cmd: formatToolCallCommand(toolName, args),
      path,
    },
  ];
}

function getStructuredToolParsedIntents(
  toolName: string,
  args: Record<string, unknown> | null,
): EventProjectionToolParsedIntent[] {
  const baseName = baseToolName(toolName);
  if (isStructuredReadToolName(baseName)) {
    return buildStructuredReadIntents(toolName, args);
  }
  if (isStructuredSearchToolName(baseName)) {
    return buildStructuredSearchIntents(toolName, args);
  }
  if (isStructuredListToolName(baseName)) {
    return buildStructuredListIntents(toolName, args);
  }
  return [];
}

function getDelegationMetadata(
  toolName: string,
  args: Record<string, unknown> | null,
): DelegationMetadata {
  if (!isDelegationToolName(toolName)) {
    return {};
  }

  const subagentType = getFirstStringField(args, [
    "subagent_type",
    "subagentType",
  ]);
  const description = getFirstStringField(args, ["description", "prompt"]);
  const model = getFirstStringField(args, ["model"]);
  return {
    ...(subagentType ? { subagentType } : {}),
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
  };
}

function formatToolCallResultOutput(toolName: string, output: string): string {
  if (baseToolName(toolName) === "Agent") {
    return stripAgentOutputMetadata(output);
  }
  return output;
}

export function parseExecLifecycleEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
  parentToolCallIdOverride?: string,
): ExecLifecycleEvent | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (decoded.type === "item/commandExecution/outputDelta") {
    const callId = decoded.itemId;
    if (!callId) return null;
    return {
      kind: "output",
      output: {
        callId,
        output: decoded.delta,
        status: "pending",
        ...(parentToolCallId ? { parentToolCallId } : {}),
      },
      ...(decoded.reset ? { replaceOutput: true } : { appendOutput: true }),
    };
  }

  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "commandExecution"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    const kind = decoded.type === "item/started" ? "begin" : "end";
    const exitCode = decoded.item.exitCode;
    const status =
      exitCode !== undefined && exitCode !== 0
        ? "error"
        : itemStatusToExecStatus(decoded.item.status);
    const completedAt = kind === "end" ? meta.createdAt : null;

    const command = extractShellCommandFromString(decoded.item.command);
    return {
      kind,
      call: {
        kind: "command",
        callId,
        command,
        cwd: decoded.item.cwd,
        parsedIntents: parseShellCommandIntents(command),
        output: decoded.item.aggregatedOutput,
        exitCode,
        completedAt,
        approvalStatus: itemStatusToApprovalStatus(decoded.item.approvalStatus),
        status,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      },
    };
  }

  return null;
}

/** The neutral tool name a v3 delegation row carries: it has no tool. */
export const DELEGATION_ITEM_TOOL_NAME = "delegation";

function parseDelegationItemLifecycleEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
  parentToolCallId: string | undefined,
): ExecLifecycleEvent | null {
  if (
    decoded.type !== "item/started" &&
    decoded.type !== "item/completed" &&
    decoded.type !== "item/delegation/completed"
  ) {
    return null;
  }
  if (decoded.item.type !== "delegation") {
    return null;
  }
  const kind = decoded.type === "item/started" ? "begin" : "end";
  const status =
    kind === "end" ? itemStatusToExecStatus(decoded.item.status) : "pending";
  return {
    kind,
    call: {
      kind: "delegation",
      callId: decoded.item.id,
      toolName: DELEGATION_ITEM_TOOL_NAME,
      description: decoded.item.label,
      output: kind === "end" ? decoded.item.summary : undefined,
      completedAt: kind === "end" ? meta.createdAt : null,
      status,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    },
  };
}

/**
 * Grammar v3 `fileRead` and `search` items (Claude Read/Grep/Glob, and every
 * provider's reads and searches as its bridge migrates) project to the
 * tool-call row with the parsed intent the legacy structured tool calls
 * produced, so the activity bundles ("Read x", "Searched for y") keep
 * rendering until the presentation-driven projection lands. The row's tool
 * name is the item kind: a v3 item has no tool.
 */
function parseExplorationItemLifecycleEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
  parentToolCallId: string | undefined,
): ExecLifecycleEvent | null {
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return null;
  }
  const item = decoded.item;
  if (item.type !== "fileRead" && item.type !== "search") {
    return null;
  }
  const kind = decoded.type === "item/started" ? "begin" : "end";
  const parsedIntents: EventProjectionToolParsedIntent[] =
    item.type === "fileRead"
      ? [
          {
            type: "read",
            cmd: item.cmd ?? `Read ${item.path}`,
            name: item.type,
            path: item.path,
          },
        ]
      : item.mode === "content"
        ? [
            {
              type: "search",
              cmd: item.cmd ?? `Grep ${item.query}`,
              query: item.query,
              path: item.path ?? null,
            },
          ]
        : [
            {
              type: "list_files",
              cmd: item.cmd ?? `Glob ${item.query}`,
              path: item.path ?? item.query,
            },
          ];
  return {
    kind,
    call: {
      kind: "tool-call",
      callId: item.id,
      toolName: item.type,
      toolArgs: null,
      parsedIntents,
      completedAt: kind === "end" ? meta.createdAt : null,
      status: kind === "end" ? itemStatusToExecStatus(item.status) : "pending",
      ...(parentToolCallId ? { parentToolCallId } : {}),
    },
  };
}

export function parseToolCallLifecycleEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
  parentToolCallIdOverride?: string,
): ExecLifecycleEvent | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (
    decoded.type === "item/toolCall/progress" ||
    decoded.type === "item/mcpToolCall/progress"
  ) {
    return {
      kind: "output",
      output: {
        callId: decoded.itemId,
        output: decoded.message ?? "Progress update",
        status: "pending",
        ...(parentToolCallId ? { parentToolCallId } : {}),
      },
    };
  }

  // A grammar v3 `delegation` item (codex native sub-agents, and every
  // provider's delegated work once its bridge migrates): the child's label is
  // the row description and the child's terminal summary is its output. The
  // full v3 projection (presentation-driven rows for every kind) is a later
  // workstream; this keeps delegation rows — and the child content nested
  // under them — rendering in the meantime.
  const delegationEvent = parseDelegationItemLifecycleEvent(
    decoded,
    meta,
    parentToolCallId,
  );
  if (delegationEvent) {
    return delegationEvent;
  }
  const explorationEvent = parseExplorationItemLifecycleEvent(
    decoded,
    meta,
    parentToolCallId,
  );
  if (explorationEvent) {
    return explorationEvent;
  }

  if (decoded.type === "item/started" || decoded.type === "item/completed") {
    if (decoded.item.type !== "toolCall") return null;

    const callId = decoded.item.id;
    if (!callId) return null;
    const toolName = decoded.item.tool;
    const serverPrefix = decoded.item.server ? `${decoded.item.server}:` : "";
    const fullToolName = `${serverPrefix}${toolName}`;
    const parsedArgs = decoded.item.arguments ?? null;

    const kind = decoded.type === "item/started" ? "begin" : "end";
    const status =
      kind === "end" ? itemStatusToExecStatus(decoded.item.status) : "pending";
    const completedAt = kind === "end" ? meta.createdAt : null;
    const result = decoded.item.result;
    const rawOutput =
      typeof result === "string"
        ? result
        : result !== undefined
          ? JSON.stringify(result)
          : undefined;
    const output =
      rawOutput !== undefined
        ? formatToolCallResultOutput(fullToolName, rawOutput)
        : undefined;
    const errorField = decoded.item.error;
    const parsedIntents = getStructuredToolParsedIntents(
      fullToolName,
      parsedArgs,
    );
    const executionKind = isDelegationToolName(fullToolName)
      ? "delegation"
      : "tool-call";
    const delegationMetadata = getDelegationMetadata(fullToolName, parsedArgs);
    const toolArgs = parseToolArgs(parsedArgs);
    const statusLabels = decoded.item.statusLabels;

    const baseCall = {
      callId,
      toolName: fullToolName,
      output: kind === "end" ? (output ?? errorField) : undefined,
      completedAt,
      status,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };

    if (executionKind === "delegation") {
      return {
        kind,
        call: {
          ...baseCall,
          kind: executionKind,
          ...delegationMetadata,
        },
      };
    }

    return {
      kind,
      call: {
        ...baseCall,
        kind: executionKind,
        toolArgs,
        ...(statusLabels ? { statusLabels } : {}),
        parsedIntents,
        ...delegationMetadata,
      },
    };
  }

  return null;
}
