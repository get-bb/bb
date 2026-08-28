#!/usr/bin/env node

import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";

let threadCounter = 0;
let turnCounter = 0;
const openTurnIdsByThreadId = new Map();
const processInstanceId = `${process.pid}-${Date.now()}-${Math.random()}`;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const ZERO_WORK_PROMPT_TEXT = "/clear";

const LATE_TURN_START_PROMPT_TEXT = "/late-start";
const LATE_TURN_START_DELAY_MS = 60;

const INTERRUPTIBLE_PROMPT_TEXT = "/wait-for-interrupt";

const SUBAGENT_THEN_CRASH_PROMPT_TEXT = "/subagent-then-crash";

function firstInputText(input) {
  const first = Array.isArray(input) ? input[0] : undefined;
  return first && first.type === "text" ? first.text : undefined;
}

const FIXED_TOKEN_USAGE = {
  total: {
    totalTokens: 39970,
    inputTokens: 39960,
    cachedInputTokens: 0,
    outputTokens: 10,
    reasoningOutputTokens: 0,
  },
  last: {
    totalTokens: 19993,
    inputTokens: 19988,
    cachedInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 0,
  },
  modelContextWindow: 258400,
};

function runScriptedTurn(threadId) {
  turnCounter += 1;
  const turnId = `turn-fx-${turnCounter}`;
  const itemId = `item-fx-${turnCounter}`;
  const text = `hello from codex turn ${turnCounter}`;
  openTurnIdsByThreadId.set(threadId, turnId);

  notify("turn/started", {
    threadId,
    turn: { id: turnId, status: "inProgress" },
  });
  notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: text });
  notify("item/completed", {
    threadId,
    turnId,
    item: { type: "agentMessage", id: itemId, text },
  });
  if (String(threadId).startsWith("usage-replay-")) {
    notify("thread/tokenUsage/updated", {
      threadId,
      turnId,
      tokenUsage: FIXED_TOKEN_USAGE,
    });
  }
  notify("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed" },
  });
  openTurnIdsByThreadId.delete(threadId);
}

const scriptPath = process.argv[2];
const script = scriptPath
  ? z
      .record(z.string(), z.json())
      .parse(JSON.parse(readFileSync(scriptPath, "utf8")))
  : null;
const scriptedTurns = script?.turns ?? null;
const modelListFailOnceMarkerPath = script?.modelListFailOnceMarkerPath ?? null;
const archiveStatePath = script?.archiveStatePath ?? null;
let renameEmptyRolloutFailuresLeft = script?.renameEmptyRolloutFailures ?? 0;
const archivedThreadIds = new Set();
const processLogPath = script?.processLogPath ?? null;
const startDelayMs = script?.startDelayMs ?? 0;

function logProcessStep(step) {
  if (processLogPath === null) {
    return;
  }
  appendFileSync(processLogPath, `${step}:${process.pid}:${process.ppid}\n`);
}

logProcessStep("spawn");
process.on("SIGTERM", () => {
  logProcessStep("exit");
  process.exit(0);
});
let scriptedTurnIndex = 0;

function readArchivedThreadIds() {
  if (archiveStatePath === null) {
    return archivedThreadIds;
  }
  if (!existsSync(archiveStatePath)) {
    return new Set();
  }
  return new Set(JSON.parse(readFileSync(archiveStatePath, "utf8")));
}

function setThreadArchived(threadId, archived) {
  const ids = readArchivedThreadIds();
  if (archived) {
    ids.add(threadId);
  } else {
    ids.delete(threadId);
  }
  if (archiveStatePath === null) {
    return;
  }
  writeFileSync(archiveStatePath, JSON.stringify([...ids]));
}

function isThreadArchived(threadId) {
  return readArchivedThreadIds().has(threadId);
}

function shouldFailThisModelList() {
  if (modelListFailOnceMarkerPath === null) {
    return false;
  }
  try {
    closeSync(openSync(modelListFailOnceMarkerPath, "wx"));
    return true;
  } catch (error) {
    const parsed = z.object({ code: z.literal("EEXIST") }).safeParse(error);
    if (parsed.success) {
      return false;
    }
    throw error;
  }
}

function withThreadId(value, threadId) {
  if (Array.isArray(value)) {
    return value.map((entry) => withThreadId(entry, threadId));
  }
  const parsed = z.record(z.string(), z.json()).safeParse(value);
  if (!parsed.success) {
    return value;
  }
  const rewritten = {};
  for (const [key, entry] of Object.entries(parsed.data)) {
    const parsedEntry = z.string().safeParse(entry);
    rewritten[key] =
      key === "threadId" && parsedEntry.success
        ? threadId
        : withThreadId(entry, threadId);
  }
  return rewritten;
}

let outboundRequestCounter = 0;
const pendingOutboundRequests = new Map();

function requestFromClient(method, params) {
  outboundRequestCounter += 1;
  const id = `fx-req-${outboundRequestCounter}`;
  return new Promise((resolve) => {
    pendingOutboundRequests.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

const turnCursorPath = script?.turnCursorPath ?? null;

function takeScriptedTurnIndex() {
  if (turnCursorPath === null) {
    const index = scriptedTurnIndex;
    scriptedTurnIndex += 1;
    return index;
  }
  const index = existsSync(turnCursorPath)
    ? Number(readFileSync(turnCursorPath, "utf8"))
    : 0;
  writeFileSync(turnCursorPath, String(index + 1));
  return index;
}

async function runScriptFileTurn(threadId) {
  const turn = scriptedTurns[takeScriptedTurnIndex()] ?? [];
  for (const entry of turn) {
    const params = withThreadId(entry.params ?? {}, threadId);
    if (entry.kind === "request") {
      await requestFromClient(entry.method, params);
      continue;
    }
    if (entry.method === "turn/started") {
      openTurnIdsByThreadId.set(threadId, params.turn.id);
    }
    if (entry.method === "turn/completed") {
      openTurnIdsByThreadId.delete(threadId);
    }
    notify(entry.method, params);
  }
}

function replayLastTurnUsage(threadId) {
  notify("thread/tokenUsage/updated", {
    threadId,
    turnId: "turn-fx-1",
    tokenUsage: FIXED_TOKEN_USAGE,
  });
}

async function handleRequest(message) {
  const { id, method } = message;
  const params = message.params ?? {};
  switch (method) {
    case "initialize":
      respond(id, {});
      return;
    case "account/rateLimits/read":
      respond(id, { rateLimits: {} });
      return;
    case "model/list":
      if (shouldFailThisModelList()) {
        respond(id, { data: [] });
        return;
      }
      respond(id, {
        data: [
          {
            id: `fake-model-${processInstanceId}`,
            model: `fake-model-${processInstanceId}`,
            displayName: "Fake model",
            description: "Hermetic bridge fixture model",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      });
      return;
    case "skills/extraRoots/set":
      respond(id, {});
      return;
    case "thread/start": {
      if (startDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, startDelayMs));
      }
      threadCounter += 1;
      const threadId = `codex-fx-${process.pid}-${threadCounter}`;
      notify("thread/started", { thread: { id: threadId } });
      respond(id, { thread: { id: threadId } });
      return;
    }
    case "thread/resume": {
      if (
        String(params.threadId).startsWith("archived-") ||
        isThreadArchived(params.threadId)
      ) {
        respondError(
          id,
          -32603,
          `session ${params.threadId} is archived; unarchive it and retry`,
        );
        return;
      }
      if (String(params.threadId).startsWith("usage-replay-")) {
        replayLastTurnUsage(params.threadId);
      }
      respond(id, { thread: { id: params.threadId } });
      return;
    }
    case "thread/fork": {
      if (
        String(params.threadId).startsWith("archived-") ||
        isThreadArchived(params.threadId)
      ) {
        respondError(
          id,
          -32603,
          `session ${params.threadId} is archived; unarchive it and retry`,
        );
        return;
      }
      threadCounter += 1;
      const replaysUsage = String(params.threadId).startsWith("usage-replay-");
      const threadId = replaysUsage
        ? `usage-replay-fork-${process.pid}-${threadCounter}`
        : `codex-fx-${process.pid}-fork-${threadCounter}`;
      respond(id, { thread: { id: threadId } });
      if (replaysUsage) {
        replayLastTurnUsage(threadId);
      }
      return;
    }
    case "turn/start": {
      if (firstInputText(params.input) === ZERO_WORK_PROMPT_TEXT) {
        respond(id, {});
        return;
      }
      if (firstInputText(params.input) === SUBAGENT_THEN_CRASH_PROMPT_TEXT) {
        turnCounter += 1;
        const turnId = `turn-fx-${turnCounter}`;
        openTurnIdsByThreadId.set(params.threadId, turnId);
        notify("turn/started", {
          threadId: params.threadId,
          turn: { id: turnId, status: "inProgress" },
        });
        notify("item/completed", {
          threadId: params.threadId,
          turnId,
          item: {
            type: "subAgentActivity",
            id: `call-fx-${turnCounter}`,
            kind: "started",
            agentThreadId: `codex-fx-sub-${turnCounter}`,
            agentPath: "reviewer",
          },
        });
        respond(id, {});
        setTimeout(() => process.exit(1), 20);
        return;
      }
      if (firstInputText(params.input) === LATE_TURN_START_PROMPT_TEXT) {
        respond(id, {});
        setTimeout(
          () => runScriptedTurn(params.threadId),
          LATE_TURN_START_DELAY_MS,
        );
        return;
      }
      if (firstInputText(params.input) === INTERRUPTIBLE_PROMPT_TEXT) {
        turnCounter += 1;
        const turnId = `turn-fx-${turnCounter}`;
        openTurnIdsByThreadId.set(params.threadId, turnId);
        notify("turn/started", {
          threadId: params.threadId,
          turn: { id: turnId, status: "inProgress" },
        });
        respond(id, {});
        return;
      }
      if (scriptedTurns) {
        await runScriptFileTurn(params.threadId);
      } else {
        runScriptedTurn(params.threadId);
      }
      respond(id, {});
      return;
    }
    case "turn/steer":
      respond(id, {});
      return;
    case "turn/interrupt": {
      const openTurnId = openTurnIdsByThreadId.get(params.threadId);
      if (openTurnId !== undefined) {
        openTurnIdsByThreadId.delete(params.threadId);
        notify("turn/completed", {
          threadId: params.threadId,
          turn: { id: openTurnId, status: "interrupted" },
        });
      }
      respond(id, {});
      return;
    }
    case "thread/archive":
      if (isThreadArchived(params.threadId)) {
        respondError(
          id,
          -32603,
          `no rollout found for thread id ${params.threadId}`,
        );
        return;
      }
      setThreadArchived(params.threadId, true);
      respond(id, {});
      return;
    case "thread/unarchive":
      if (!isThreadArchived(params.threadId)) {
        respondError(
          id,
          -32603,
          `no archived rollout found for thread id ${params.threadId}`,
        );
        return;
      }
      setThreadArchived(params.threadId, false);
      respond(id, {});
      return;
    case "thread/name/set":
      if (renameEmptyRolloutFailuresLeft > 0) {
        renameEmptyRolloutFailuresLeft -= 1;
        respondError(
          id,
          -32603,
          `failed to set thread name: rollout at /tmp/${params.threadId}.jsonl is empty`,
        );
        return;
      }
      respond(id, {});
      return;
    case "thread/compact/start":
    case "thread/goal/clear":
      respond(id, {});
      return;
    default:
      respondError(id, -32601, `Unknown method "${method}"`);
  }
}

const stdinLines = createInterface({ input: process.stdin, terminal: false });
stdinLines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  const parsedObject = z.record(z.string(), z.json()).safeParse(parsed);
  if (!parsedObject.success) {
    return;
  }
  const method = z.string().safeParse(parsedObject.data.method);
  if (parsedObject.data.id !== undefined && method.success) {
    void handleRequest(parsedObject.data);
    return;
  }
  if (parsedObject.data.id !== undefined) {
    const resolve = pendingOutboundRequests.get(parsedObject.data.id);
    if (resolve) {
      pendingOutboundRequests.delete(parsedObject.data.id);
      resolve(parsedObject.data);
    }
  }
});
stdinLines.on("close", () => {
  logProcessStep("exit");
  process.exit(0);
});
