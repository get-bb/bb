#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  if (process.env.FAKE_PI_PROCESS_LOG) {
    try {
      appendFileSync(
        process.env.FAKE_PI_PROCESS_LOG,
        `version:${process.pid}:${process.ppid}\n`,
      );
    } catch {}
  }
  if (process.env.FAKE_PI_VERSION === "crash") {
    process.stderr.write(
      "Error: pi 0.84.0 failed to start\n    at main (pi.js:1:1)\n",
    );
    process.exit(1);
  }
  process.stdout.write(`${process.env.FAKE_PI_VERSION ?? "0.84.0"}\n`);
  process.exit(0);
}
function flag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
const sessionFile = args.includes("--no-session")
  ? undefined
  : flag("--session");
const extensionPath = flag("--extension");
const processLogPath = process.env.FAKE_PI_PROCESS_LOG;
const commandLogPath = process.env.FAKE_PI_COMMAND_LOG;
if (sessionFile !== undefined) {
  mkdirSync(dirname(sessionFile), { recursive: true });
  if (!existsSync(sessionFile)) {
    const header = {
      type: "session",
      version: 3,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, "utf8");
  }
}

function logProcessStep(step) {
  if (!processLogPath) return;
  try {
    appendFileSync(processLogPath, `${step}:${process.pid}:${process.ppid}\n`);
  } catch {}
}
logProcessStep("spawn");
let exiting = false;
function exit() {
  if (exiting) return;
  exiting = true;
  logProcessStep("exit");
  process.exit(0);
}
const hangOnClose = process.env.FAKE_PI_HANG_ON_CLOSE === "1";
process.on("SIGTERM", () => {
  if (hangOnClose) return;
  exit();
});
if (process.env.FAKE_PI_EXIT_BEFORE_FIRST_RESPONSE === "1") {
  exit();
}

const MODELS = [
  {
    id: "fake-model",
    name: "Fake Model",
    provider: "fake-provider",
    input: ["text"],
    reasoning: true,
    contextWindow: 200_000,
  },
  {
    id: "fake-mini",
    name: "Fake Mini",
    provider: "fake-provider",
    input: ["text"],
    reasoning: false,
    contextWindow: 32_000,
  },
];

let model = MODELS[0];
const requestedModel = flag("--model");
let spawnIndex = 1;
if (process.env.FAKE_PI_SPAWN_COUNTER_FILE) {
  try {
    spawnIndex =
      Number(readFileSync(process.env.FAKE_PI_SPAWN_COUNTER_FILE, "utf8")) + 1;
  } catch {
    spawnIndex = 1;
  }
  writeFileSync(
    process.env.FAKE_PI_SPAWN_COUNTER_FILE,
    String(spawnIndex),
    "utf8",
  );
}
const ignoreRequestedModel =
  process.env.FAKE_PI_MISMATCH_FIRST_SPAWN === "1" && spawnIndex === 1;
if (requestedModel !== undefined && !ignoreRequestedModel) {
  const [provider, id] = requestedModel.split("/");
  model =
    MODELS.find((entry) => entry.provider === provider && entry.id === id) ??
    MODELS[0];
}
let thinkingLevel = flag("--thinking") ?? "medium";
let isStreaming = false;
let isCompacting = false;
let leafCounter = 0;
let leafId = null;
let turnCounter = 0;
let tokens = 0;
let holdAbort = null;
const followUp = [];
const steering = [];
let endedWithStreamingFlag = false;

let heldLine = null;

function send(message) {
  const line = `${JSON.stringify(message)}\n`;
  if (heldLine === null) {
    process.stdout.write(line);
    return;
  }
  process.stdout.write(`${heldLine}${line}`);
  heldLine = null;
}
function holdUntilNextSend(message) {
  heldLine = `${JSON.stringify(message)}\n`;
}
function respond(id, command, data) {
  const response = { id, type: "response", command, success: true };
  if (data !== undefined) Object.assign(response, { data });
  send(response);
}
function respondError(id, command, error) {
  send({ id, type: "response", command, success: false, error });
}
function event(payload) {
  send(payload);
}
function queueUpdate() {
  event({
    type: "queue_update",
    steering: [...steering],
    followUp: [...followUp],
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const extensionTools = new Map();
const extensionHandlers = new Map();
let activeTools = ["read", "bash", "edit", "write"];
const scopedModel =
  process.env.FAKE_PI_SCOPE_BY_SPAWN === "1"
    ? MODELS[spawnIndex === 1 ? 0 : 1]
    : undefined;
const extensionContext = {
  cwd: process.cwd(),
  sessionManager: { getLeafId: () => leafId },
  model: scopedModel,
  scopedModels: scopedModel ? [{ model: scopedModel }] : [],
};

async function emitExtensionEvent(type, payload = {}) {
  for (const handler of extensionHandlers.get(type) ?? []) {
    await handler({ type, ...payload }, extensionContext);
  }
}

async function loadExtension(path) {
  const aliases = new Map([
    [
      "@earendil-works/pi-coding-agent",
      import.meta.resolve("@earendil-works/pi-coding-agent"),
    ],
    ["typebox", import.meta.resolve("typebox")],
  ]);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = aliases.get(specifier);
      return url
        ? { url, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  const module = await import(pathToFileURL(path).href);
  module.default({
    registerTool(tool) {
      extensionTools.set(tool.name, tool);
      if (process.env.FAKE_PI_TOOLS_DUMP) {
        appendFileSync(
          process.env.FAKE_PI_TOOLS_DUMP,
          `${JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })}\n`,
        );
      }
    },
    on(type, handler) {
      const handlers = extensionHandlers.get(type) ?? [];
      handlers.push(handler);
      extensionHandlers.set(type, handlers);
    },
    getActiveTools: () => [...activeTools],
    setActiveTools(names) {
      activeTools = [...names];
    },
  });
  if (process.env.FAKE_PI_NO_SESSION_START !== "1") {
    await emitExtensionEvent("session_start");
  }
}

async function runExtensionTool(name, toolArgs) {
  const tool = extensionTools.get(name);
  const toolCallId = `call-${turnCounter}`;
  event({
    type: "tool_execution_start",
    toolCallId,
    toolName: name,
    args: toolArgs,
  });
  let result;
  let isError = false;
  try {
    result = tool
      ? await tool.execute(toolCallId, toolArgs, new AbortController().signal)
      : { content: [{ type: "text", text: `no tool ${name}` }], details: {} };
  } catch (error) {
    isError = true;
    result = {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  event({
    type: "tool_execution_end",
    toolCallId,
    toolName: name,
    result,
    isError,
  });
  return result;
}

async function runPrompt(text) {
  isStreaming = true;
  turnCounter += 1;
  await emitExtensionEvent("agent_start");
  event({ type: "agent_start" });
  event({ type: "turn_start" });
  if (text === "/hold") {
    const released = await new Promise((resolve) => {
      holdAbort = resolve;
    });
    holdAbort = null;
    if (released === "steer") {
      const steerText =
        process.env.FAKE_PI_DROP_STEER_AT_END === "1" ? null : steering.shift();
      if (steerText !== null && steerText !== undefined) {
        queueUpdate();
      }
      const reply =
        steerText === null || steerText === undefined
          ? "Held run ended"
          : `Steered: ${steerText}`;
      const steered = {
        role: "assistant",
        content: [{ type: "text", text: reply }],
        stopReason: "stop",
        provider: model.provider,
        model: model.id,
        usage: { input: 12, output: 5, totalTokens: 17 },
      };
      event({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: reply,
          contentIndex: 0,
        },
        message: steered,
      });
      event({ type: "message_end", message: steered });
      event({ type: "turn_end", message: steered, toolResults: [] });
      leafCounter += 1;
      leafId = `leaf-${leafCounter}`;
      const messages = [{ role: "user", content: text }, steered];
      await emitExtensionEvent("agent_end", { messages });
      endedWithStreamingFlag = process.env.FAKE_PI_STREAMING_AFTER_END === "1";
      event({ type: "agent_end", messages });
      isStreaming = endedWithStreamingFlag;
      return;
    }
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      stopReason: "aborted",
      provider: model.provider,
      model: model.id,
      usage: { input: 1, output: 0, totalTokens: 1 },
    };
    event({ type: "turn_end", message, toolResults: [] });
    await emitExtensionEvent("agent_end", { messages: [message] });
    event({ type: "agent_end", messages: [message] });
    isStreaming = false;
    return;
  }
  if (text === "/die") {
    process.exit(0);
  }
  let toolResultText = "";
  const toolMatch = text.match(/^\/tool (\S+) ?(.*)$/su);
  if (toolMatch) {
    let toolArgs = {};
    try {
      toolArgs = toolMatch[2] ? JSON.parse(toolMatch[2]) : {};
    } catch {
      toolArgs = { raw: toolMatch[2] };
    }
    const result = await runExtensionTool(toolMatch[1], toolArgs);
    toolResultText = (result?.content ?? [])
      .filter((block) => block && block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  const failed = text === "/fail-run";
  const reply = failed
    ? ""
    : toolMatch
      ? `Tool said: ${toolResultText}`
      : `Response to: ${text}`;
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: reply }],
    provider: model.provider,
    model: model.id,
    usage: { input: 12, output: 5, totalTokens: 17 },
    ...(failed
      ? { stopReason: "error", errorMessage: "scripted run failure" }
      : { stopReason: "stop" }),
  };
  event({ type: "message_start", message: { role: "assistant", content: [] } });
  if (!failed) {
    event({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: reply,
        contentIndex: 0,
      },
      message: assistant,
    });
  }
  event({ type: "message_end", message: assistant });
  event({ type: "turn_end", message: assistant, toolResults: [] });
  tokens += 17;
  leafCounter += 1;
  leafId = `leaf-${leafCounter}`;
  const messages = [{ role: "user", content: text }, assistant];
  await emitExtensionEvent("agent_end", { messages });
  event({ type: "agent_end", messages });
  isStreaming = false;
}

async function drainFollowUps() {
  while (followUp.length > 0) {
    const text = followUp.shift();
    queueUpdate();
    await runPrompt(text);
  }
}

async function handle(command) {
  const id = command.id;
  if (commandLogPath) {
    appendFileSync(commandLogPath, `${command.type}\n`);
  }
  switch (command.type) {
    case "get_state":
      respond(id, "get_state", {
        model,
        thinkingLevel,
        isStreaming,
        isCompacting,
        steeringMode: "one-at-a-time",
        followUpMode: "one-at-a-time",
        sessionFile,
        sessionId: "fake-session",
        autoCompactionEnabled: true,
        messageCount: turnCounter * 2,
        pendingMessageCount: followUp.length,
      });
      return;
    case "get_available_models":
      respond(id, "get_available_models", { models: MODELS });
      if (
        process.env.FAKE_PI_EXIT_AFTER_FIRST_AVAILABLE === "1" &&
        spawnIndex === 1
      ) {
        setTimeout(exit, 25);
      }
      return;
    case "set_model": {
      const found = MODELS.find(
        (entry) =>
          entry.provider === command.provider && entry.id === command.modelId,
      );
      if (!found) {
        respondError(
          id,
          "set_model",
          `Model not found: ${command.provider}/${command.modelId}`,
        );
        return;
      }
      model = found;
      respond(id, "set_model", model);
      return;
    }
    case "set_thinking_level":
      thinkingLevel = command.level;
      respond(id, "set_thinking_level");
      return;
    case "get_session_stats":
      respond(id, "get_session_stats", {
        sessionFile,
        sessionId: "fake-session",
        userMessages: turnCounter,
        assistantMessages: turnCounter,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: turnCounter * 2,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: tokens,
        },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        contextUsage: {
          tokens,
          contextWindow: model.contextWindow,
          percent: 0,
        },
      });
      return;
    case "prompt": {
      if (isStreaming && command.streamingBehavior === "steer") {
        steering.push(command.message);
        queueUpdate();
        if (process.env.FAKE_PI_BATCH_STEER_REPLY === "1" && holdAbort) {
          holdUntilNextSend({
            id,
            type: "response",
            command: "prompt",
            success: true,
          });
        } else {
          respond(id, "prompt");
        }
        if (holdAbort) {
          holdAbort("steer");
        }
        return;
      }
      if (isStreaming) {
        followUp.push(command.message);
        queueUpdate();
        respond(id, "prompt");
        return;
      }
      respond(id, "prompt");
      await runPrompt(command.message);
      await drainFollowUps();
      return;
    }
    case "steer":
      respond(id, "steer");
      return;
    case "abort":
      if (holdAbort) {
        holdAbort("abort");
        await sleep(5);
      }
      isStreaming = false;
      endedWithStreamingFlag = false;
      respond(id, "abort");
      return;
    case "compact": {
      isCompacting = true;
      event({ type: "compaction_start", reason: "manual" });
      await sleep(5);
      if (turnCounter === 0) {
        const errorMessage =
          "Compaction failed: Nothing to compact (session too small)";
        event({
          type: "compaction_end",
          reason: "manual",
          aborted: false,
          willRetry: false,
          errorMessage,
        });
        isCompacting = false;
        respondError(id, "compact", "Nothing to compact (session too small)");
        return;
      }
      event({ type: "compaction_end", reason: "manual", aborted: false });
      isCompacting = false;
      leafCounter += 1;
      leafId = `leaf-${leafCounter}`;
      respond(id, "compact", {
        summary: "scripted summary",
        tokensBefore: tokens,
        firstKeptEntryId: leafId,
      });
      return;
    }
    default:
      respondError(id, command.type, `Unknown command "${command.type}"`);
  }
}

function readLines(input, onLine) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  input.on("data", (chunk) => {
    const text = decoder.write(chunk);
    let start = 0;
    for (;;) {
      const index = text.indexOf("\n", start);
      if (index === -1) {
        pending += text.slice(start);
        return;
      }
      const line = pending + text.slice(start, index);
      pending = "";
      start = index + 1;
      onLine(line);
    }
  });
}

const loaded = extensionPath ? loadExtension(extensionPath) : Promise.resolve();
let chain = loaded;
readLines(process.stdin, (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let command;
  try {
    command = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (
    command.type === "abort" ||
    command.type === "get_state" ||
    command.type === "get_session_stats" ||
    (command.type === "prompt" && command.streamingBehavior === "steer")
  ) {
    void loaded.then(() => handle(command));
    return;
  }
  chain = chain.then(() => handle(command));
});
process.stdin.on("end", () => {
  if (!hangOnClose) exit();
});
process.stdin.on("close", () => {
  if (!hangOnClose) exit();
});
if (hangOnClose) {
  setInterval(() => undefined, 60_000);
}
