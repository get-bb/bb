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
 * - FAKE_ACP_MODELS_FIELD=1  → advertise legacy ACP models state
 * - FAKE_ACP_THOUGHT_LEVEL_CONFIG=1
 *                            → advertise per-model effort configOptions
 * - FAKE_ACP_SET_CONFIG_MODEL_ERROR=1
 *                            → fail session/set_config_option for model values
 * - FAKE_ACP_MODEL_COUNT=<n> → pad the catalog to n reasoning-capable models
 *                              (exercises large-catalog reasoning discovery)
 * - FAKE_ACP_WRITE_PATH      → target path for the "write-file" prompt
 * - FAKE_ACP_LAUNCH_LOG      → append one line per process launch (used to
 *                              count model-discovery spawns in cache/TTL tests)
 */

import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";

const loadSession = process.env.FAKE_ACP_LOAD_SESSION === "1";
const modelConfig = process.env.FAKE_ACP_MODEL_CONFIG === "1";
const modelsField = process.env.FAKE_ACP_MODELS_FIELD === "1";
const thoughtLevelConfig = process.env.FAKE_ACP_THOUGHT_LEVEL_CONFIG === "1";
const setConfigModelError = process.env.FAKE_ACP_SET_CONFIG_MODEL_ERROR === "1";
const hangInitialize = process.env.FAKE_ACP_HANG_INITIALIZE === "1";
const sessionId = `fake-sess-${process.pid}`;
const fakeModels = [
  { value: "fake/default", name: "Fake Default" },
  { value: "fake/strong", name: "Fake Strong" },
];

let activePromptId = null;
let nextAgentRequestId = 1000;
let selectedModel = "fake/default";
let selectedEffort = "none";
const pendingClientRequests = new Map();
let currentMcpServers = [];

const effortsByModel = new Map([
  ["fake/strong", ["none", "low", "medium", "high", "xhigh"]],
]);

const modelCount = Number(process.env.FAKE_ACP_MODEL_COUNT ?? "0");
for (let i = fakeModels.length; i < modelCount; i += 1) {
  const value = `fake/gen-${i}`;
  fakeModels.push({ value, name: `Fake Gen ${i}` });
  effortsByModel.set(value, ["low", "medium", "high"]);
}

process.on("SIGTERM", () => {
  if (process.env.FAKE_ACP_SIGNAL_FILE) {
    writeFileSync(process.env.FAKE_ACP_SIGNAL_FILE, "SIGTERM\n");
  }
  process.exit(0);
});

if (process.env.FAKE_ACP_READY_FILE) {
  writeFileSync(process.env.FAKE_ACP_READY_FILE, "ready\n");
}

if (process.env.FAKE_ACP_LAUNCH_LOG) {
  appendFileSync(process.env.FAKE_ACP_LAUNCH_LOG, `launch ${process.pid}\n`);
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

function effortOptionForModel(model) {
  const efforts = thoughtLevelConfig ? effortsByModel.get(model) : undefined;
  if (!efforts) {
    return undefined;
  }
  if (!efforts.includes(selectedEffort)) {
    selectedEffort = efforts[0];
  }
  return {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: selectedEffort,
    options: efforts.map((value) => ({ value })),
  };
}

function configOptions() {
  if (!modelConfig) {
    return undefined;
  }
  return [
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
      currentValue: selectedModel,
      options: fakeModels,
    },
    effortOptionForModel(selectedModel),
  ].filter(Boolean);
}

function configState() {
  const state = {};
  const options = configOptions();
  if (options !== undefined) {
    state.configOptions = options;
  }
  if (modelsField) {
    state.models = {
      currentModelId: selectedModel,
      availableModels: fakeModels.map((model) => ({
        modelId: model.value,
        name: model.name,
      })),
    };
  }
  return state;
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

function captureMcpServers(message) {
  currentMcpServers = Array.isArray(message.params?.mcpServers)
    ? message.params.mcpServers
    : [];
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
  } else if (text.includes("echo-selected-effort")) {
    notifyUpdate(messageChunk(`selected-effort:${selectedEffort}`));
  } else if (text.includes("echo-electron-run-as-node")) {
    notifyUpdate(
      messageChunk(
        `electron-run-as-node:${process.env.ELECTRON_RUN_AS_NODE ?? "missing"}`,
      ),
    );
  } else if (text.includes("echo-mcp-servers")) {
    const names = currentMcpServers
      .map((server) => server?.name)
      .filter((name) => typeof name === "string")
      .join(",");
    notifyUpdate(messageChunk(`mcp-servers:${names}`));
  } else if (text.includes("echo-mcp-server-config")) {
    notifyUpdate(
      messageChunk(`mcp-server-config:${JSON.stringify(currentMcpServers)}`),
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
      captureMcpServers(message);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          sessionId,
          ...configState(),
        },
      });
      return;
    case "session/load":
      if (loadSession) {
        captureMcpServers(message);
        send({ jsonrpc: "2.0", id: message.id, result: configState() });
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
        (!modelConfig && !modelsField) ||
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
      send({ jsonrpc: "2.0", id: message.id, result: configState() });
      return;
    }
    case "session/set_config_option": {
      const configId = message.params?.configId;
      const value = message.params?.value;
      if (configId === "model") {
        if (setConfigModelError) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: "model config probe failed" },
          });
          return;
        }
        if (
          !modelConfig ||
          typeof value !== "string" ||
          !fakeModels.some((model) => model.value === value)
        ) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: `model not found: ${value}` },
          });
          return;
        }
        selectedModel = value;
        send({ jsonrpc: "2.0", id: message.id, result: configState() });
        return;
      }
      if (configId === "effort") {
        const efforts = effortsByModel.get(selectedModel);
        if (
          !thoughtLevelConfig ||
          typeof value !== "string" ||
          !efforts?.includes(value)
        ) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: `effort not found: ${value}` },
          });
          return;
        }
        selectedEffort = value;
        send({ jsonrpc: "2.0", id: message.id, result: configState() });
        return;
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: `Unknown config ${configId}` },
      });
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
