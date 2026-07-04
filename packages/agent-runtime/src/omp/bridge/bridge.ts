/* eslint-disable no-console */
/**
 * omp bridge: a thin framing translator between bb's JSON-RPC 2.0 provider
 * transport and omp's RPC protocol (`omp --mode rpc`).
 *
 * bb spawns this bridge under `node` (one bridge per provider process). The
 * bridge speaks JSON-RPC 2.0 on stdin/stdout and spawns the user-installed
 * `omp` CLI, speaking omp's newline-delimited `{type:...}` JSON protocol over
 * its stdio. No omp SDK is bundled — omp owns its auth, models, and runtime.
 *
 * Protocol map (bb JSON-RPC -> omp RPC):
 *   initialize            -> (no omp call; ack)
 *   model/list            -> get_available_models
 *   thread/start          -> new_session + set_model? + set_thinking_level? + ...
 *   thread/resume         -> switch_session + set_model? + set_thinking_level? + ...
 *   turn/start {input}    -> switch_session? + prompt {message}
 *   turn/steer {input}    -> switch_session? + steer {message}
 *   thread/stop           -> switch_session? + abort
 *
 * omp events (agent_start, message_update, agent_end, ...) are forwarded to bb
 * as `sdk/message` notifications carrying the raw omp event.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  resolveOmpBridgeSessionDir,
  resolveOmpSessionFilePath,
} from "./session-paths.js";

// ---------------------------------------------------------------------------
// bb <-> bridge JSON-RPC 2.0 framing
// ---------------------------------------------------------------------------

interface BbRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const bbRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function sendToBb(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sendResult(id: string | number, result: unknown): void {
  sendToBb({ jsonrpc: "2.0", id, result });
}

function sendError(
  id: string | number,
  code: number,
  message: string,
): void {
  sendToBb({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  sendToBb({ jsonrpc: "2.0", method, params });
}

// ---------------------------------------------------------------------------
// omp child process
// ---------------------------------------------------------------------------

interface PendingOmpRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

interface OmpSpawnConfig {
  cwd: string;
  cliArgs: string[];
  env: Record<string, string>;
}

interface ThreadSession {
  threadId: string;
  cwd: string;
  sessionPath: string;
  spawnConfig: OmpSpawnConfig;
}

const OMP_BINARY_ENV = "BB_OMP_BINARY";
const DEFAULT_OMP_CLI_ARGS = ["--mode", "rpc", "--no-title"];
let ompChild: ChildProcessWithoutNullStreams | null = null;
let ompReady: Promise<void> | null = null;
let ompCommandCounter = 0;
const pendingOmpRequests = new Map<string, PendingOmpRequest>();
const threadSessions = new Map<string, ThreadSession>();
let activeSessionKey: string | undefined;
let activeThreadId: string | undefined;
let currentSpawnConfig: OmpSpawnConfig | undefined;
const stderrTail: string[] = [];
const STDERR_TAIL_MAX_LINES = 40;

function resolveOmpBinary(): string {
  return process.env[OMP_BINARY_ENV] ?? "omp";
}

function forwardOmpEvent(rawEvent: unknown): void {
  const threadId = activeThreadId ?? "thr_omp";
  sendNotification("sdk/message", { threadId, message: rawEvent });
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const ompReadyFrameSchema = z.object({ type: z.literal("ready") });

const ompResponseFrameSchema = z.object({
  type: z.literal("response"),
  id: z.string().optional(),
  success: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
});

// omp protocol housekeeping the bridge absorbs rather than forwarding as agent
// events. `extension_ui_request` is handled separately (it must be answered).
const ompExtensionUiRequestSchema = z.object({
  type: z.literal("extension_ui_request"),
  id: z.string(),
});
const ompFrameTypeSchema = z.object({ type: z.string() });
const OMP_CONSUMED_FRAME_TYPES = new Set([
  "available_commands_update",
  "prompt_result",
]);

function handleOmpLine(line: string): void {
  if (line.trim().length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    return;
  }
  if (ompReadyFrameSchema.safeParse(parsed).success) {
    return;
  }

  // omp RPC responses: {type:"response", id, success, data?, error?}
  const response = ompResponseFrameSchema.safeParse(parsed);
  if (response.success) {
    const id = response.data.id;
    if (id !== undefined) {
      const pending = pendingOmpRequests.get(id);
      if (pending) {
        pendingOmpRequests.delete(id);
        if (response.data.success === false) {
          pending.reject(
            new Error(
              typeof response.data.error === "string"
                ? response.data.error
                : "omp RPC error",
            ),
          );
        } else {
          pending.resolve(response.data.data);
        }
      }
    }
    return;
  }

  // omp extension UI requests (setWidget, confirm, ...) block until answered.
  // bb has no UI surface for them, so dismiss immediately so omp continues.
  const extensionUi = ompExtensionUiRequestSchema.safeParse(parsed);
  if (extensionUi.success) {
    writeOmp({ type: "extension_ui_response", id: extensionUi.data.id, cancelled: true });
    return;
  }

  // Other omp protocol housekeeping with no agent-event meaning for bb.
  const frameType = ompFrameTypeSchema.safeParse(parsed);
  if (frameType.success && OMP_CONSUMED_FRAME_TYPES.has(frameType.data.type)) {
    return;
  }

  // Everything else is an AgentSessionEvent (agent_start, message_update,
  // agent_end, tool_execution_*, auto_compaction_*, ...).
  forwardOmpEvent(parsed);
}

function rejectPendingOmpRequests(error: Error): void {
  const pending = [...pendingOmpRequests.values()];
  pendingOmpRequests.clear();
  for (const request of pending) {
    request.reject(error);
  }
}

function resetOmpProcessState(): void {
  ompChild = null;
  ompReady = null;
  activeSessionKey = undefined;
  activeThreadId = undefined;
}

async function waitForOmpExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

async function stopOmp(): Promise<void> {
  const child = ompChild;
  if (!child) {
    resetOmpProcessState();
    return;
  }
  resetOmpProcessState();
  rejectPendingOmpRequests(new Error("omp process is restarting"));
  child.kill();
  await waitForOmpExit(child);
}

function startOmp(config: OmpSpawnConfig): Promise<void> {
  ompCommandCounter = 0;
  pendingOmpRequests.clear();
  stderrTail.length = 0;

  ompReady = new Promise<void>((resolve, reject) => {
    const binary = resolveOmpBinary();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binary, config.cliArgs, {
        cwd: config.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...config.env },
      });
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error(`Failed to spawn omp: ${String(error)}`),
      );
      return;
    }
    ompChild = child;

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const exitThreadId = activeThreadId;
      resetOmpProcessState();
      rejectPendingOmpRequests(
        new Error(
          `omp process exited${code !== null ? ` (code ${code})` : signal ? ` (${signal})` : ""}`,
        ),
      );
      if (exitThreadId) {
        sendNotification("error", {
          threadId: exitThreadId,
          message: `omp process exited${
            stderrTail.length > 0
              ? `: ${stderrTail.join("\n")}`
              : code !== null
                ? ` (code ${code})`
                : ""
          }`,
        });
      }
    };

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to launch omp binary "${binary}" (${error.message}). Install omp or set ${OMP_BINARY_ENV}.`,
        ),
      );
    });
    child.once("exit", onExit);

    const stdout = createInterface({
      input: child.stdout,
      terminal: false,
    });
    let resolved = false;
    stdout.on("line", (line: string) => {
      if (!resolved) {
        const trimmed = line.trim();
        if (
          trimmed.length > 0 &&
          ompReadyFrameSchema.safeParse(safeParseJson(trimmed)).success
        ) {
          resolved = true;
          resolve();
          return;
        }
      }
      handleOmpLine(line);
    });

    const stderr = createInterface({
      input: child.stderr,
      terminal: false,
    });
    stderr.on("line", (line: string) => {
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_MAX_LINES) {
        stderrTail.shift();
      }
      process.stderr.write(`${line}\n`);
    });
  });
  return ompReady;
}

function writeOmp(value: unknown): void {
  if (!ompChild || !ompChild.stdin.writable) {
    throw new Error("omp process is not running");
  }
  ompChild.stdin.write(`${JSON.stringify(value)}\n`);
}

function sendOmpCommand<T = unknown>(
  command: Omit<Record<string, unknown>, "type"> & { type: string },
): Promise<T> {
  ompCommandCounter += 1;
  const id = `bb_${ompCommandCounter}`;
  const payload = { ...command, id };
  return new Promise<T>((resolve, reject) => {
    pendingOmpRequests.set(id, {
      resolve: (data) => resolve(data as T),
      reject,
    });
    try {
      writeOmp(payload);
    } catch (error) {
      pendingOmpRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function defaultSpawnConfig(cwd = process.cwd()): OmpSpawnConfig {
  return {
    cwd,
    cliArgs: [...DEFAULT_OMP_CLI_ARGS],
    env: {},
  };
}

function spawnConfigKey(config: OmpSpawnConfig): string {
  const envEntries = Object.entries(config.env).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify({
    cwd: config.cwd,
    cliArgs: config.cliArgs,
    env: envEntries,
  });
}

async function ensureOmp(config?: OmpSpawnConfig): Promise<void> {
  const resolved = config ?? currentSpawnConfig ?? defaultSpawnConfig();
  if (
    ompChild &&
    ompReady &&
    currentSpawnConfig &&
    spawnConfigKey(currentSpawnConfig) === spawnConfigKey(resolved)
  ) {
    await ompReady;
    return;
  }
  if (ompChild) {
    await stopOmp();
  }
  currentSpawnConfig = resolved;
  await startOmp(resolved);
}

// ---------------------------------------------------------------------------
// PromptInput -> omp message text
// ---------------------------------------------------------------------------

const promptTextInputSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

function flattenPromptInputToMessage(input: unknown): string {
  if (!Array.isArray(input)) {
    return "";
  }
  // Validate each part individually so a text part survives alongside an
  // attachment (image/file) — attachments are dropped, text is preserved.
  const texts: string[] = [];
  for (const part of input) {
    const parsed = promptTextInputSchema.safeParse(part);
    if (parsed.success) {
      texts.push(parsed.data.text);
    }
  }
  return texts.join("");
}

// ---------------------------------------------------------------------------
// bb command handlers
// ---------------------------------------------------------------------------

function splitOmpModel(
  model: string,
): { provider: string; modelId: string } | null {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    return null;
  }
  return {
    provider: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const paths = value.filter((entry): entry is string => typeof entry === "string");
  return paths.length > 0 ? paths : undefined;
}

function readEnvVars(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const envVars: Record<string, string> = {};
  for (const [key, envValue] of Object.entries(value)) {
    if (typeof envValue === "string") {
      envVars[key] = envValue;
    }
  }
  return Object.keys(envVars).length > 0 ? envVars : undefined;
}

function mapOmpThinkingLevel(level: unknown): string | undefined {
  if (typeof level !== "string") {
    return undefined;
  }
  switch (level) {
    case "none":
      return "off";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
    case "ultracode":
    case "max":
      return "xhigh";
    default:
      return undefined;
  }
}

function writeSkillsConfigFile(
  threadId: string,
  additionalSkillPaths: readonly string[],
): string {
  const sessionDir = resolveOmpBridgeSessionDir({ env: process.env });
  mkdirSync(sessionDir, { recursive: true });
  const configPath = join(
    sessionDir,
    `${threadId.replace(/[^A-Za-z0-9._-]/g, "_")}-skills.yml`,
  );
  const lines = ["skills:", "  customDirectories:"];
  for (const skillPath of additionalSkillPaths) {
    lines.push(`    - ${JSON.stringify(skillPath)}`);
  }
  writeFileSync(configPath, `${lines.join("\n")}\n`);
  return configPath;
}

function buildOmpSpawnConfig(
  params: Record<string, unknown>,
  cwd: string,
  threadId: string,
): OmpSpawnConfig {
  const cliArgs = [...DEFAULT_OMP_CLI_ARGS];
  const model = typeof params.model === "string" ? params.model : undefined;
  if (model) {
    cliArgs.push("--model", model);
  }
  const thinkingLevel = mapOmpThinkingLevel(params.reasoningLevel);
  if (thinkingLevel) {
    cliArgs.push("--thinking", thinkingLevel);
  }
  if (typeof params.baseInstructions === "string") {
    cliArgs.push("--system-prompt", params.baseInstructions);
  }
  if (typeof params.appendSystemPrompt === "string") {
    cliArgs.push("--append-system-prompt", params.appendSystemPrompt);
  }
  const additionalSkillPaths = readStringArray(params.additionalSkillPaths);
  if (additionalSkillPaths) {
    cliArgs.push("--config", writeSkillsConfigFile(threadId, additionalSkillPaths));
  }
  const sessionDir = resolveOmpBridgeSessionDir({ env: process.env });
  mkdirSync(sessionDir, { recursive: true });
  cliArgs.push("--session-dir", sessionDir);

  return {
    cwd,
    cliArgs,
    env: readEnvVars(params.envVars) ?? {},
  };
}

async function applySessionOptions(
  params: Record<string, unknown>,
): Promise<void> {
  const model = typeof params.model === "string" ? params.model : undefined;
  if (model) {
    const split = splitOmpModel(model);
    if (split) {
      try {
        await sendOmpCommand({
          type: "set_model",
          provider: split.provider,
          modelId: split.modelId,
        });
      } catch {
        // Model selection failure is non-fatal; omp falls back to its default.
      }
    }
  }

  const thinkingLevel = mapOmpThinkingLevel(params.reasoningLevel);
  if (thinkingLevel) {
    try {
      await sendOmpCommand({
        type: "set_thinking_level",
        level: thinkingLevel,
      });
    } catch {
      // Thinking-level selection failure is non-fatal.
    }
  }
}

function requireThreadSession(sessionKey: string): ThreadSession {
  const session = threadSessions.get(sessionKey);
  if (!session) {
    throw new Error(`No active omp thread session for "${sessionKey}"`);
  }
  return session;
}

function rememberThreadSession(session: ThreadSession): void {
  threadSessions.set(session.sessionPath, session);
}

async function activateThreadSession(
  sessionKey: string,
  method: "thread/start" | "thread/resume" | "activate",
): Promise<void> {
  const session = requireThreadSession(sessionKey);
  if (activeSessionKey === sessionKey) {
    return;
  }

  if (method === "thread/start") {
    await sendOmpCommand({ type: "new_session" });
    const state = await sendOmpCommand<{ sessionFile?: string }>({
      type: "get_state",
    });
    if (typeof state?.sessionFile === "string" && state.sessionFile.length > 0) {
      session.sessionPath = state.sessionFile;
      rememberThreadSession(session);
    }
  } else {
    await sendOmpCommand({
      type: "switch_session",
      sessionPath: session.sessionPath,
    });
  }

  activeSessionKey = session.sessionPath;
  activeThreadId = session.threadId;
}

async function handleInitialize(id: string | number): Promise<void> {
  sendResult(id, { ok: true });
}

async function handleModelList(id: string | number): Promise<void> {
  try {
    await ensureOmp();
    const data = await sendOmpCommand({ type: "get_available_models" });
    // omp answers { models: [...] }; forward verbatim so the adapter's parser
    // receives the shape it expects.
    sendResult(id, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function handleThreadStart(
  id: string | number,
  params: Record<string, unknown>,
  method: "thread/start" | "thread/resume",
): Promise<void> {
  const threadId =
    typeof params.threadId === "string" ? params.threadId : `omp-${Date.now()}`;
  const providerThreadId =
    typeof params.providerThreadId === "string"
      ? params.providerThreadId
      : undefined;
  const cwd = typeof params.cwd === "string" ? params.cwd : process.cwd();
  const spawnConfig = buildOmpSpawnConfig(params, cwd, threadId);
  const sessionPath =
    providerThreadId ??
    resolveOmpSessionFilePath({
      env: process.env,
      threadId,
    });
  mkdirSync(dirname(sessionPath), { recursive: true });
  const session: ThreadSession = {
    threadId,
    cwd,
    sessionPath,
    spawnConfig,
  };
  threadSessions.set(providerThreadId ?? threadId, session);
  try {
    await ensureOmp(spawnConfig);
    await activateThreadSession(providerThreadId ?? threadId, method);
    await applySessionOptions(params);
  } catch (error) {
    threadSessions.delete(providerThreadId ?? threadId);
    threadSessions.delete(session.sessionPath);
    if (activeThreadId === threadId) {
      activeSessionKey = undefined;
      activeThreadId = undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }
  sendNotification("thread/identity", {
    threadId,
    providerThreadId: session.sessionPath,
  });
  sendResult(id, { providerThreadId: session.sessionPath });
}

async function handleTurnStart(
  id: string | number,
  params: Record<string, unknown>,
): Promise<void> {
  const threadId =
    typeof params.threadId === "string" ? params.threadId : undefined;
  if (!threadId) {
    sendError(id, -32602, "Missing threadId");
    return;
  }
  const message = flattenPromptInputToMessage(params.input);
  try {
    const session = requireThreadSession(threadId);
    await ensureOmp(session.spawnConfig);
    await activateThreadSession(threadId, "activate");
    await applySessionOptions(params);
    // `prompt` is acked immediately by omp; turn completion arrives via the
    // agent_end event forwarded above. Resolve bb once the prompt is sent.
    void sendOmpCommand({ type: "prompt", message }).catch((error) => {
      // omp rejecting the command or a broken-stdin write would otherwise hang
      // the turn silently — surface it so the adapter can fail the turn.
      const detail = error instanceof Error ? error.message : String(error);
      sendNotification("error", {
        threadId,
        message: `omp prompt failed: ${detail}`,
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, msg);
    return;
  }
  sendResult(id, { ok: true });
}

async function handleTurnSteer(
  id: string | number,
  params: Record<string, unknown>,
): Promise<void> {
  const threadId =
    typeof params.threadId === "string" ? params.threadId : undefined;
  if (!threadId) {
    sendError(id, -32602, "Missing threadId");
    return;
  }
  const message = flattenPromptInputToMessage(params.input);
  try {
    const session = requireThreadSession(threadId);
    await ensureOmp(session.spawnConfig);
    await activateThreadSession(threadId, "activate");
    void sendOmpCommand({ type: "steer", message }).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      sendNotification("error", {
        threadId,
        message: `omp steer failed: ${detail}`,
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, msg);
    return;
  }
  sendResult(id, { ok: true });
}

async function handleThreadStop(
  id: string | number,
  params: Record<string, unknown>,
): Promise<void> {
  const threadId =
    typeof params.threadId === "string" ? params.threadId : undefined;
  try {
    if (threadId) {
      const session = threadSessions.get(threadId);
      if (session) {
        await ensureOmp(session.spawnConfig);
        await activateThreadSession(threadId, "activate");
      }
    } else {
      await ensureOmp();
    }
    void sendOmpCommand({ type: "abort" }).catch(() => {});
  } catch {
    // Best-effort abort; resolve regardless.
  }
  sendResult(id, { ok: true });
}

async function handleRequest(request: BbRequest): Promise<void> {
  const id = request.id ?? 0;
  const params = request.params ?? {};
  switch (request.method) {
    case "initialize":
      await handleInitialize(id);
      return;
    case "model/list":
      await handleModelList(id);
      return;
    case "thread/start":
      await handleThreadStart(id, params, "thread/start");
      return;
    case "thread/resume":
      await handleThreadStart(id, params, "thread/resume");
      return;
    case "turn/start":
      await handleTurnStart(id, params);
      return;
    case "turn/steer":
      await handleTurnSteer(id, params);
      return;
    case "thread/stop":
      await handleThreadStop(id, params);
      return;
    default:
      sendError(id, -32601, `Unknown omp bridge method: ${request.method}`);
  }
}

function handleLine(line: string): void {
  if (line.trim().length === 0) {
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return;
  }
  const parsed = bbRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }
  void handleRequest(parsed.data).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.data.id !== undefined) {
      sendError(parsed.data.id, -32603, message);
    } else {
      sendNotification("error", { message });
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const stdinInterface = createInterface({
  input: process.stdin,
  terminal: false,
});
stdinInterface.on("line", handleLine);
stdinInterface.on("close", () => {
  rejectPendingOmpRequests(new Error("bb bridge stdin closed"));
  if (ompChild) {
    ompChild.kill();
  }
  process.exit(0);
});
