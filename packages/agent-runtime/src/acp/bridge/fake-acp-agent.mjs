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
 * - FAKE_ACP_MODEL_CONFIG=1  → advertise a model configOptions select
 * - FAKE_ACP_WRITE_PATH      → target path for the "write-file" prompt
 */

import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const loadSession = process.env.FAKE_ACP_LOAD_SESSION === "1";
const modelConfig = process.env.FAKE_ACP_MODEL_CONFIG === "1";
const hangInitialize = process.env.FAKE_ACP_HANG_INITIALIZE === "1";
const sessionId = `fake-sess-${process.pid}`;
const fakeModels = [
  { value: "fake/default", name: "Fake Default" },
  { value: "fake/strong", name: "Fake Strong" },
];

let activePromptId = null;
let nextAgentRequestId = 1000;
let selectedModel = "fake/default";
const pendingClientRequests = new Map();

process.on("SIGTERM", () => {
  if (process.env.FAKE_ACP_SIGNAL_FILE) {
    writeFileSync(process.env.FAKE_ACP_SIGNAL_FILE, "SIGTERM\n");
  }
  process.exit(0);
});

if (process.env.FAKE_ACP_READY_FILE) {
  writeFileSync(process.env.FAKE_ACP_READY_FILE, "ready\n");
}

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
  } else if (text.includes("echo-selected-model")) {
    notifyUpdate(messageChunk(`selected-model:${selectedModel}`));
  } else if (text.includes("echo-electron-run-as-node")) {
    notifyUpdate(
      messageChunk(
        `electron-run-as-node:${process.env.ELECTRON_RUN_AS_NODE ?? "missing"}`,
      ),
    );
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
      if (hangInitialize) {
        return;
      }
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
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          sessionId,
          ...(modelConfig
            ? {
                configOptions: [
                  {
                    id: "mode",
                    name: "Mode",
                    category: "mode",
                    type: "select",
                    currentValue: true,
                    options: [{ value: "build", name: "Build" }],
                  },
                  {
                    id: "model",
                    name: "Model",
                    category: "model",
                    type: "select",
                    currentValue: "fake/default",
                    options: fakeModels,
                  },
                ],
              }
            : {}),
        },
      });
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
    case "session/set_model": {
      const modelId = message.params?.modelId;
      if (
        !modelConfig ||
        typeof modelId !== "string" ||
        !fakeModels.some((model) => model.value === modelId)
      ) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32602, message: `model not found: ${modelId}` },
        });
        return;
      }
      selectedModel = modelId;
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
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
