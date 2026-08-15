#!/usr/bin/env node

/**
 * Minimal scripted `codex app-server` for hermetic codex-bridge tests.
 *
 * Speaks the subset of the app-server dialect the bridge drives: initialize,
 * thread/start|resume|fork returning a thread identity (plus the
 * thread/started notification a real app-server emits), and turn/start
 * answering with a full scripted turn. The scripted turn is deliberately
 * DELTA-FIRST — `item/agentMessage/delta` arrives before any `item/started`
 * for that item — so the bridge's item-opening synthesis is exercised for
 * real by the conformance kit's item/opens-before-delta rule.
 */

import { createInterface } from "node:readline";

let threadCounter = 0;
let turnCounter = 0;
const openTurnIdsByThreadId = new Map();

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
  // Delta-first: no item/started for the agent message. The bridge must
  // synthesize the opening event.
  notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: text });
  notify("item/completed", {
    threadId,
    turnId,
    item: { type: "agentMessage", id: itemId, text },
  });
  notify("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed" },
  });
  openTurnIdsByThreadId.delete(threadId);
}

function handleRequest(message) {
  const { id, method } = message;
  const params = message.params ?? {};
  switch (method) {
    case "initialize":
      respond(id, {});
      return;
    case "account/rateLimits/read":
      respond(id, { rateLimits: {} });
      return;
    case "skills/extraRoots/set":
      respond(id, {});
      return;
    case "thread/start": {
      threadCounter += 1;
      const threadId = `codex-fx-${process.pid}-${threadCounter}`;
      notify("thread/started", { thread: { id: threadId } });
      respond(id, { thread: { id: threadId } });
      return;
    }
    case "thread/resume": {
      respond(id, { thread: { id: params.threadId } });
      return;
    }
    case "thread/fork": {
      threadCounter += 1;
      const threadId = `codex-fx-${process.pid}-fork-${threadCounter}`;
      respond(id, { thread: { id: threadId } });
      return;
    }
    case "turn/start": {
      runScriptedTurn(params.threadId);
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
    case "thread/compact/start":
    case "thread/archive":
    case "thread/unarchive":
    case "thread/name/set":
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
  if (typeof parsed !== "object" || parsed === null) {
    return;
  }
  if (parsed.id !== undefined && typeof parsed.method === "string") {
    handleRequest(parsed);
  }
});
stdinLines.on("close", () => {
  process.exit(0);
});
