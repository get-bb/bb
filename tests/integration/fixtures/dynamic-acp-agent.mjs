#!/usr/bin/env node

import { createInterface } from "node:readline";

const listMode = process.argv.includes("--list-models");
if (listMode) {
  console.log("bb-dynamic-smoke-medium - Dynamic Smoke Medium");
  console.log("bb-dynamic-smoke-high - Dynamic Smoke High");
  process.exit(0);
}

const selectedModelFlagIndex = process.argv.indexOf("--model");
const launchSelectedModel =
  selectedModelFlagIndex >= 0
    ? process.argv[selectedModelFlagIndex + 1]
    : "acp-default";

let nextSession = 1;
const loadedSessions = new Map();

const acpModels = [
  {
    value: "bb-dynamic-acp-native-default",
    name: "Dynamic ACP Native Default",
  },
  { value: "bb-dynamic-acp-native-strong", name: "Dynamic ACP Native Strong" },
];
const defaultAcpModel = acpModels[0].value;

function initialSessionModel() {
  return launchSelectedModel === "acp-default"
    ? defaultAcpModel
    : launchSelectedModel;
}

function write(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function result(id, value) {
  write({ id, result: value ?? null });
}

function sessionUpdate(sessionId, text) {
  write({
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function promptText(prompt) {
  if (!Array.isArray(prompt)) {
    return "";
  }
  return prompt
    .map((entry) => (entry?.type === "text" ? entry.text : ""))
    .filter((text) => text && !text.startsWith("<system_instructions>"))
    .join(" ");
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = message;
  if (id === undefined || typeof method !== "string") {
    return;
  }

  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false },
        },
      });
      return;

    case "session/new": {
      const sessionId = `dyn-session-${nextSession}`;
      nextSession += 1;
      loadedSessions.set(sessionId, initialSessionModel());
      result(id, {
        sessionId,
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: defaultAcpModel,
            options: acpModels,
          },
        ],
      });
      return;
    }

    case "session/load": {
      const sessionId = params?.sessionId;
      if (typeof sessionId === "string") {
        loadedSessions.set(sessionId, initialSessionModel());
        result(id, null);
        return;
      }
      write({
        id,
        error: { code: -32602, message: "sessionId is required" },
      });
      return;
    }

    case "session/set_model": {
      const sessionId = params?.sessionId;
      const modelId = params?.modelId;
      if (typeof sessionId !== "string" || !loadedSessions.has(sessionId)) {
        write({
          id,
          error: { code: -32000, message: "unknown session" },
        });
        return;
      }
      if (
        typeof modelId !== "string" ||
        !acpModels.some((model) => model.value === modelId)
      ) {
        write({
          id,
          error: { code: -32602, message: `model not found: ${modelId}` },
        });
        return;
      }
      loadedSessions.set(sessionId, modelId);
      result(id, {});
      return;
    }

    case "session/prompt": {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || !loadedSessions.has(sessionId)) {
        write({
          id,
          error: { code: -32000, message: "unknown session" },
        });
        return;
      }
      sessionUpdate(
        sessionId,
        `dynamic-acp:model=${loadedSessions.get(sessionId)}:${promptText(params?.prompt)}`,
      );
      result(id, { stopReason: "end_turn" });
      return;
    }

    default:
      write({
        id,
        error: { code: -32601, message: `unsupported method ${method}` },
      });
  }
});
