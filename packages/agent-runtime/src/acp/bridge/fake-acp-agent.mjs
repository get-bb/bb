#!/usr/bin/env node

/**
 * Scripted fake ACP agent for bridge tests.
 *
 * Speaks just enough of the Agent Client Protocol to exercise the bridge:
 * initialize/session lifecycle, streamed message chunks, permission requests,
 * client fs writes, cancellation, and (env-gated) session/load support.
 *
 * Env knobs (passed by tests through thread/start envVars):
 * - FAKE_ACP_LOAD_SESSION=1  → advertise + accept session/load
 * - FAKE_ACP_WRITE_PATH      → target path for the "write-file" prompt
 */

import { createInterface } from "node:readline";

const loadSession = process.env.FAKE_ACP_LOAD_SESSION === "1";
const sessionId = `fake-sess-${process.pid}`;

let activePromptId = null;
let nextAgentRequestId = 1000;
const pendingClientRequests = new Map();

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function notifyUpdate(update) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}

function messageChunk(text) {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  };
}

function requestClient(method, params) {
  nextAgentRequestId += 1;
  const id = nextAgentRequestId;
  return new Promise((resolve, reject) => {
    pendingClientRequests.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promptText(prompt) {
  return (Array.isArray(prompt) ? prompt : [])
    .filter((block) => block && block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function handlePrompt(message) {
  activePromptId = message.id;
  const text = promptText(message.params?.prompt);

  if (text.includes("request-permission")) {
    notifyUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "perm-tool-1",
      title: "Run rm",
      kind: "execute",
      status: "pending",
      rawInput: { command: "rm -rf /tmp/scratch" },
    });
    let outcome = "cancelled";
    try {
      const result = await requestClient("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "perm-tool-1",
          title: "Run rm",
          kind: "execute",
          rawInput: { command: "rm -rf /tmp/scratch" },
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "no", name: "Deny", kind: "reject_once" },
        ],
      });
      outcome =
        result?.outcome?.outcome === "selected"
          ? result.outcome.optionId
          : "cancelled";
    } catch {
      outcome = "error";
    }
    notifyUpdate(messageChunk(`permission:${outcome}`));
  } else if (text.includes("write-file")) {
    try {
      await requestClient("fs/write_text_file", {
        sessionId,
        path: process.env.FAKE_ACP_WRITE_PATH,
        content: "hello from agent\n",
      });
      notifyUpdate(messageChunk("write:ok"));
    } catch {
      notifyUpdate(messageChunk("write:denied"));
    }
  } else if (text.includes("hang")) {
    // Stay pending until the client sends session/cancel.
    return;
  } else if (text.includes("die")) {
    process.exit(7);
  } else if (text.includes("slow")) {
    notifyUpdate(messageChunk(`echo:${text}`));
    await sleep(300);
  } else if (text.includes("echo-argv")) {
    // Lets bridge tests assert the launch args (e.g. the --model pin).
    notifyUpdate(messageChunk(`argv:${process.argv.slice(2).join(" ")}`));
  } else {
    notifyUpdate(messageChunk(`echo:${text}`));
  }

  if (activePromptId === message.id) {
    activePromptId = null;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn" },
    });
  }
}

async function handleMessage(message) {
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession,
            promptCapabilities: { image: false },
          },
        },
      });
      return;
    case "session/new":
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
      return;
    case "session/load":
      if (loadSession) {
        send({ jsonrpc: "2.0", id: message.id, result: null });
      } else {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "session/load is not supported" },
        });
      }
      return;
    case "session/prompt":
      await handlePrompt(message);
      return;
    case "session/cancel":
      if (activePromptId !== null) {
        const id = activePromptId;
        activePromptId = null;
        send({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
      }
      return;
    default:
      if (message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Unknown method ${message.method}` },
        });
      }
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && message.method === undefined) {
    const pending = pendingClientRequests.get(message.id);
    if (pending) {
      pendingClientRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "client error"));
      } else {
        pending.resolve(message.result);
      }
    }
    return;
  }
  void handleMessage(message);
});
rl.on("close", () => {
  process.exit(0);
});
