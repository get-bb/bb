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

function isRecord(value) {
  return (
    value !== null &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function isString(value) {
  return Object.prototype.toString.call(value) === "[object String]";
}

function stringField(value, key) {
  const candidate = isRecord(value) ? value[key] : undefined;
  return isString(candidate) ? candidate : undefined;
}

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
    .map((entry) =>
      isRecord(entry) && entry.type === "text" && isString(entry.text)
        ? entry.text
        : "",
    )
    .filter((text) => text && !text.startsWith("<system_instructions>"))
    .join(" ");
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  if (!isRecord(parsed)) {
    return;
  }
  const message = parsed;
  const { id, method, params } = message;
  if (id === undefined || !isString(method)) {
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
      const sessionId = stringField(params, "sessionId");
      if (sessionId !== undefined) {
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
      const sessionId = stringField(params, "sessionId");
      const modelId = stringField(params, "modelId");
      if (sessionId === undefined || !loadedSessions.has(sessionId)) {
        write({
          id,
          error: { code: -32000, message: "unknown session" },
        });
        return;
      }
      if (
        modelId === undefined ||
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
      const sessionId = stringField(params, "sessionId");
      if (sessionId === undefined || !loadedSessions.has(sessionId)) {
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
