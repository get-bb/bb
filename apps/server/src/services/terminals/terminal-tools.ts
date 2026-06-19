import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  TERMINAL_COLS_MAX,
  TERMINAL_ROWS_MAX,
  terminalColsSchema,
  terminalRowsSchema,
  type DynamicTool,
  type ToolCallResponse,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { getTurnExecutionOptions } from "../threads/thread-events.js";

const DEFAULT_TOOL_COLS = 100;
const DEFAULT_TOOL_ROWS = 30;
const DEFAULT_TOOL_TAIL_BYTES = 12_000;
const DEFAULT_TOOL_LIMIT_CHUNKS = 200;

export const TERMINAL_TOOL_NAMES = {
  list: "bb_terminal_list",
  output: "bb_terminal_output",
  resize: "bb_terminal_resize",
  send: "bb_terminal_send",
  start: "bb_terminal_start",
  stop: "bb_terminal_stop",
} as const;

const startArgsSchema = z
  .object({
    command: z.string().trim().min(1).max(10_000),
    title: z.string().trim().min(1).max(200).optional(),
    cols: terminalColsSchema.optional(),
    rows: terminalRowsSchema.optional(),
  })
  .strict();

const terminalIdArgsSchema = z
  .object({
    terminalId: z.string().min(1),
  })
  .strict();

const outputArgsSchema = terminalIdArgsSchema.extend({
  sinceSeq: z.number().int().nonnegative().optional(),
  tailBytes: z.number().int().positive().optional(),
  limitChunks: z.number().int().positive().optional(),
});

const resizeArgsSchema = terminalIdArgsSchema.extend({
  cols: terminalColsSchema,
  rows: terminalRowsSchema,
});

const sendArgsSchema = terminalIdArgsSchema.extend({
  text: z.string(),
  enter: z.boolean().optional(),
});

type TerminalToolName =
  (typeof TERMINAL_TOOL_NAMES)[keyof typeof TERMINAL_TOOL_NAMES];

interface HandleTerminalToolCallArgs {
  callId: string;
  deps: AppDeps;
  tool: string;
  toolArgs: unknown;
  turnId: string;
  threadId: string;
}

export function buildTerminalDynamicTools(): DynamicTool[] {
  return [
    {
      name: TERMINAL_TOOL_NAMES.list,
      description: "List running BB terminal sessions for this thread.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: TERMINAL_TOOL_NAMES.start,
      description:
        "Start a long-running command in a persistent BB terminal for this thread. Requires full permission mode.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["command"],
        properties: {
          command: { type: "string" },
          title: { type: "string" },
          cols: { type: "integer", minimum: 1, maximum: TERMINAL_COLS_MAX },
          rows: { type: "integer", minimum: 1, maximum: TERMINAL_ROWS_MAX },
        },
      },
    },
    {
      name: TERMINAL_TOOL_NAMES.output,
      description:
        "Read bounded recent output from a BB terminal in this thread. Use sinceSeq, tailBytes, or limitChunks to keep responses small.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId"],
        properties: {
          terminalId: { type: "string" },
          sinceSeq: { type: "integer", minimum: 0 },
          tailBytes: { type: "integer", minimum: 1 },
          limitChunks: { type: "integer", minimum: 1 },
        },
      },
    },
    {
      name: TERMINAL_TOOL_NAMES.send,
      description:
        "Send text to a BB terminal in this thread. Requires full permission mode.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId", "text"],
        properties: {
          terminalId: { type: "string" },
          text: { type: "string" },
          enter: { type: "boolean" },
        },
      },
    },
    {
      name: TERMINAL_TOOL_NAMES.resize,
      description:
        "Resize a BB terminal in this thread. Requires full permission mode.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId", "cols", "rows"],
        properties: {
          terminalId: { type: "string" },
          cols: { type: "integer", minimum: 1, maximum: TERMINAL_COLS_MAX },
          rows: { type: "integer", minimum: 1, maximum: TERMINAL_ROWS_MAX },
        },
      },
    },
    {
      name: TERMINAL_TOOL_NAMES.stop,
      description:
        "Stop a BB terminal in this thread. Requires full permission mode.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId"],
        properties: {
          terminalId: { type: "string" },
        },
      },
    },
  ];
}

export function isTerminalToolName(tool: string): tool is TerminalToolName {
  return Object.values(TERMINAL_TOOL_NAMES).includes(tool as TerminalToolName);
}

export async function handleTerminalToolCall(
  args: HandleTerminalToolCallArgs,
): Promise<ToolCallResponse> {
  try {
    switch (args.tool) {
      case TERMINAL_TOOL_NAMES.list:
        return toolSuccess(
          JSON.stringify(
            {
              sessions: args.deps.terminalSessions.listThreadTerminals(
                args.threadId,
              ),
            },
            null,
            2,
          ),
        );
      case TERMINAL_TOOL_NAMES.start:
        requireFullPermission(args);
        return startTerminal(args);
      case TERMINAL_TOOL_NAMES.output:
        return readTerminalOutput(args);
      case TERMINAL_TOOL_NAMES.send:
        requireFullPermission(args);
        return sendTerminalInput(args);
      case TERMINAL_TOOL_NAMES.resize:
        requireFullPermission(args);
        return resizeTerminal(args);
      case TERMINAL_TOOL_NAMES.stop:
        requireFullPermission(args);
        return stopTerminal(args);
      default:
        return toolFailure(`Unsupported terminal tool: ${args.tool}`);
    }
  } catch (error) {
    return toolFailure(error instanceof Error ? error.message : String(error));
  }
}

function requireFullPermission(args: HandleTerminalToolCallArgs): void {
  const execution = getTurnExecutionOptions(args.deps, {
    threadId: args.threadId,
    turnId: args.turnId,
  });
  if (execution?.permissionMode !== "full") {
    throw new Error(
      "Terminal start/send/resize/stop require full permission mode for this turn.",
    );
  }
}

async function startTerminal(
  args: HandleTerminalToolCallArgs,
): Promise<ToolCallResponse> {
  const parsed = startArgsSchema.parse(args.toolArgs ?? {});
  const session = await args.deps.terminalSessions.createThreadTerminal({
    threadId: args.threadId,
    payload: {
      cols: parsed.cols ?? DEFAULT_TOOL_COLS,
      rows: parsed.rows ?? DEFAULT_TOOL_ROWS,
      title: parsed.title,
      start: { mode: "command", command: parsed.command },
    },
  });
  return toolSuccess(
    [
      `started terminal ${session.id}`,
      `title: ${session.title}`,
      `status: ${session.status}`,
      `attach: bb thread terminal attach ${session.id} ${args.threadId}`,
      `output: bb thread terminal output ${session.id} ${args.threadId} --json`,
    ].join("\n"),
  );
}

async function readTerminalOutput(
  args: HandleTerminalToolCallArgs,
): Promise<ToolCallResponse> {
  const parsed = outputArgsSchema.parse(args.toolArgs ?? {});
  const output = await args.deps.terminalSessions.readThreadTerminalOutput({
    threadId: args.threadId,
    terminalId: parsed.terminalId,
    query: {
      sinceSeq: parsed.sinceSeq,
      tailBytes: parsed.tailBytes ?? DEFAULT_TOOL_TAIL_BYTES,
      limitChunks: parsed.limitChunks ?? DEFAULT_TOOL_LIMIT_CHUNKS,
    },
  });
  const text = output.chunks
    .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
    .join("");
  return toolSuccess(
    JSON.stringify(
      {
        terminalId: parsed.terminalId,
        nextSeq: output.nextSeq,
        truncated: output.truncated,
        output: text,
      },
      null,
      2,
    ),
  );
}

function sendTerminalInput(args: HandleTerminalToolCallArgs): ToolCallResponse {
  const parsed = sendArgsSchema.parse(args.toolArgs ?? {});
  const text = parsed.enter ? `${parsed.text}\n` : parsed.text;
  const session = args.deps.terminalSessions.sendThreadTerminalInput({
    threadId: args.threadId,
    terminalId: parsed.terminalId,
    payload: {
      dataBase64: Buffer.from(text, "utf8").toString("base64"),
    },
  });
  return toolSuccess(
    `sent input to terminal ${session.id}; status: ${session.status}`,
  );
}

function resizeTerminal(args: HandleTerminalToolCallArgs): ToolCallResponse {
  const parsed = resizeArgsSchema.parse(args.toolArgs ?? {});
  const session = args.deps.terminalSessions.resizeThreadTerminal({
    threadId: args.threadId,
    terminalId: parsed.terminalId,
    payload: {
      cols: parsed.cols,
      rows: parsed.rows,
    },
  });
  return toolSuccess(
    `resized terminal ${session.id} to ${session.cols}x${session.rows}`,
  );
}

function stopTerminal(args: HandleTerminalToolCallArgs): ToolCallResponse {
  const parsed = terminalIdArgsSchema.parse(args.toolArgs ?? {});
  const session = args.deps.terminalSessions.closeThreadTerminal({
    threadId: args.threadId,
    terminalId: parsed.terminalId,
    payload: { mode: "force", reason: "user" },
  });
  return toolSuccess(
    `stopped terminal ${session.id}; status: ${session.status}`,
  );
}

function toolSuccess(text: string): ToolCallResponse {
  return {
    success: true,
    contentItems: [{ type: "inputText", text }],
  };
}

function toolFailure(text: string): ToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text }],
  };
}
