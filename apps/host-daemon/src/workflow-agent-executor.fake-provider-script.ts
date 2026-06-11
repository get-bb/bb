// Scripted fake provider for workflow-agent-executor tests, spawned through
// `createFakeAdapter({ scriptPath })` (it speaks the fake adapter's stdio
// JSON-RPC protocol). Behaviors beyond the stock fake-provider-script:
//
// - `crash-once:<markerPath>` — on the first turn carrying this token the
//   process acks turn/start, emits turn/started, writes the marker file, then
//   exits(1) MID-TURN (the provider-death failure-mapping path). With the
//   marker present the turn completes normally, so `withRetry` around
//   `runAgent` observes crash-then-success.
// - input containing "Output only the JSON" (the executor's extraction-prompt
//   marker, also embedded in test prompts for the claude path) — the final
//   agentMessage is canned JSON, exercising structured-output parsing.
// - `schema-miss-once:<markerPath>` — remembered per thread from the working
//   turn: the thread's first JSON-marker reply (before the marker file
//   exists) is schema-VIOLATING JSON, every later one conforms. Drives the
//   workflow runtime's single corrective re-prompt end-to-end.
// - `delay:<ms>` — delays turn completion (abort/stall tests).
// - anything else echoes `Response to: <input>`.

import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = number | string;

interface ThreadState {
  providerThreadId: string;
  turnCount: number;
  activeTurn: { turnId: string; timer: NodeJS.Timeout | null } | null;
  /** Set by a working turn carrying `schema-miss-once:<path>`. */
  schemaMissMarkerPath: string | null;
}

const CANNED_JSON = '{"answer":"ok"}';
/** Violates the tests' ANSWER_SCHEMA: `answer` must be a string. */
const SCHEMA_VIOLATING_JSON = '{"answer":42}';
const JSON_MARKER = "Output only the JSON";

const rl = createInterface({ input: process.stdin });
const threads = new Map<string, ThreadState>();
let nextProviderThreadId = 1;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getJsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" ? value : 0;
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getParams(message: JsonRecord): JsonRecord {
  return isJsonRecord(message.params) ? message.params : {};
}

function send(message: JsonRecord): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseInputText(input: unknown): string {
  if (!Array.isArray(input)) {
    return "";
  }
  return input
    .filter((item): item is JsonRecord => isJsonRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join(" ");
}

function emitUserMessage(
  threadId: string,
  thread: ThreadState,
  turnId: string,
  inputText: string,
): void {
  if (inputText.length === 0) {
    return;
  }
  send({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId,
      turnId,
      providerThreadId: thread.providerThreadId,
      item: {
        type: "userMessage",
        id: `user-${process.pid}-${thread.providerThreadId}-${thread.turnCount}`,
        content: [{ type: "text", text: inputText }],
      },
    },
  });
}

function completeTurn(threadId: string, status: string, text: string): void {
  const thread = threads.get(threadId);
  if (!thread || !thread.activeTurn) {
    return;
  }
  const turn = thread.activeTurn;
  if (turn.timer) {
    clearTimeout(turn.timer);
  }
  thread.activeTurn = null;

  if (status === "completed") {
    send({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId,
        turnId: turn.turnId,
        item: {
          type: "agentMessage",
          id: `msg-${process.pid}-${thread.providerThreadId}-${thread.turnCount}`,
          text,
        },
      },
    });
  }
  send({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId,
      turnId: turn.turnId,
      providerThreadId: thread.providerThreadId,
      status,
    },
  });
}

/** First JSON reply on a schema-miss thread violates the schema (and writes
 *  the marker so the corrective attempt — a fresh thread on this same
 *  process — gets conforming JSON). */
function resolveJsonReply(thread: ThreadState): string {
  const markerPath = thread.schemaMissMarkerPath;
  if (markerPath !== null && !existsSync(markerPath)) {
    writeFileSync(markerPath, "schema-missed");
    return SCHEMA_VIOLATING_JSON;
  }
  return CANNED_JSON;
}

function beginTurn(threadId: string, input: unknown): void {
  const thread = threads.get(threadId);
  if (!thread) {
    return;
  }
  thread.turnCount += 1;
  // Globally unique like real adapters' per-process uuid-prefixed turn ids:
  // retry attempts append into ONE per-agent log, so ids from different
  // sessions/processes must never collide there.
  const turnId = `turn-${process.pid}-${thread.providerThreadId}-${thread.turnCount}`;
  thread.activeTurn = { turnId, timer: null };

  send({
    jsonrpc: "2.0",
    method: "turn/started",
    params: { threadId, turnId, providerThreadId: thread.providerThreadId },
  });

  const inputText = parseInputText(input);
  emitUserMessage(threadId, thread, turnId, inputText);

  const crashMatch = /(?:^|\s)crash-once:([^\s]+)(?:\s|$)/u.exec(inputText);
  if (crashMatch?.[1] !== undefined && !existsSync(crashMatch[1])) {
    writeFileSync(crashMatch[1], "crashed");
    process.exit(1);
  }

  const schemaMissMatch = /(?:^|\s)schema-miss-once:([^\s]+)(?:\s|$)/u.exec(
    inputText,
  );
  if (schemaMissMatch?.[1] !== undefined) {
    thread.schemaMissMarkerPath = schemaMissMatch[1];
  }

  const delayMatch = /(?:^|\s)delay:(\d+)(?:\s|$)/u.exec(inputText);
  const delayMs = delayMatch ? Number(delayMatch[1]) : 0;
  const responseText = inputText.includes(JSON_MARKER)
    ? resolveJsonReply(thread)
    : `Response to: ${inputText}`;

  thread.activeTurn.timer = setTimeout(() => {
    completeTurn(threadId, "completed", responseText);
  }, delayMs);
}

function handleMessage(message: JsonRecord): void {
  const method = getString(message.method);
  const id = getJsonRpcId(message.id);
  const params = getParams(message);

  switch (method) {
    case "initialize":
    case "skills/configure":
      send({ jsonrpc: "2.0", id, result: { ok: true } });
      return;
    case "model/list":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          models: [
            {
              id: "fake-model",
              model: "fake-model",
              displayName: "Fake Model",
              description: "Fake model for workflow executor tests",
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Medium" },
              ],
              defaultReasoningEffort: "medium",
              isDefault: true,
            },
          ],
          selectedOnlyModels: [],
        },
      });
      return;
    case "thread/start": {
      const threadId = getString(params.threadId, "unknown");
      const providerThreadId = `prov-${nextProviderThreadId}`;
      nextProviderThreadId += 1;
      threads.set(threadId, {
        providerThreadId,
        turnCount: 0,
        activeTurn: null,
        schemaMissMarkerPath: null,
      });
      send({ jsonrpc: "2.0", id, result: { providerThreadId } });
      send({
        jsonrpc: "2.0",
        method: "thread/identity",
        params: { threadId, providerThreadId },
      });
      if (Array.isArray(params.input) && params.input.length > 0) {
        beginTurn(threadId, params.input);
      }
      return;
    }
    case "turn/start": {
      const threadId = getString(params.threadId, "unknown");
      if (!threads.has(threadId)) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: `Unknown thread: ${threadId}` },
        });
        return;
      }
      send({ jsonrpc: "2.0", id, result: { ok: true } });
      beginTurn(threadId, params.input);
      return;
    }
    case "thread/stop": {
      const threadId = getString(params.threadId, "unknown");
      completeTurn(threadId, "interrupted", "");
      send({ jsonrpc: "2.0", id, result: { ok: true } });
      return;
    }
    default:
      if (typeof message.id === "string" || typeof message.id === "number") {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
  }
}

rl.on("line", (line) => {
  try {
    const parsed: unknown = JSON.parse(line);
    if (isJsonRecord(parsed) && typeof parsed.method === "string") {
      handleMessage(parsed);
    }
  } catch {
    return;
  }
});
