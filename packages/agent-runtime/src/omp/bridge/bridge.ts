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
 *   thread/start          -> set_model? + (session boots with omp's cwd)
 *   thread/resume         -> (same as thread/start; omp resumes recent session)
 *   turn/start {input}    -> prompt {message}
 *   turn/steer {input}    -> steer {message}
 *   thread/stop           -> abort
 *
 * omp events (agent_start, message_update, agent_end, ...) are forwarded to bb
 * as `sdk/message` notifications carrying the raw omp event.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

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

const OMP_BINARY_ENV = "BB_OMP_BINARY";
let ompChild: ChildProcessWithoutNullStreams | null = null;
let ompReady: Promise<void> | null = null;
let ompCommandCounter = 0;
const pendingOmpRequests = new Map<string, PendingOmpRequest>();
let currentThreadId: string | undefined;
const stderrTail: string[] = [];
const STDERR_TAIL_MAX_LINES = 40;

function resolveOmpBinary(): string {
  return process.env[OMP_BINARY_ENV] ?? "omp";
}

function forwardOmpEvent(rawEvent: unknown): void {
  const threadId = currentThreadId ?? "thr_omp";
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

function startOmp(cwd: string): Promise<void> {
  if (ompChild && ompReady) {
    return ompReady;
  }
  ompCommandCounter = 0;
  pendingOmpRequests.clear();
  stderrTail.length = 0;

  ompReady = new Promise<void>((resolve, reject) => {
    const binary = resolveOmpBinary();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binary, ["--mode", "rpc"], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
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
      const exitThreadId = currentThreadId;
      // Reset so the next ensureOmp respawns omp instead of reusing a dead
      // child (and an already-resolved ready promise) for the rest of the session.
      ompChild = null;
      ompReady = null;
      currentThreadId = undefined;
      const pending = [...pendingOmpRequests.values()];
      pendingOmpRequests.clear();
      for (const request of pending) {
        request.reject(
          new Error(
            `omp process exited${code !== null ? ` (code ${code})` : signal ? ` (${signal})` : ""}`,
          ),
        );
      }
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

async function ensureOmp(cwd?: string): Promise<void> {
  if (ompChild && ompReady) {
    await ompReady;
    return;
  }
  await startOmp(cwd ?? process.cwd());
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
}

async function handleThreadStart(
  id: string | number,
  params: Record<string, unknown>,
): Promise<void> {
  const threadId =
    typeof params.threadId === "string" ? params.threadId : `omp-${Date.now()}`;
  currentThreadId = threadId;
  const cwd = typeof params.cwd === "string" ? params.cwd : process.cwd();
  try {
    await ensureOmp(cwd);
    await applySessionOptions(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }
  sendNotification("thread/identity", {
    threadId,
    providerThreadId: threadId,
  });
  sendResult(id, { threadId });
}

async function handleTurnStart(
  id: string | number,
  params: Record<string, unknown>,
): Promise<void> {
  const message = flattenPromptInputToMessage(params.input);
  try {
    await ensureOmp();
    // `prompt` is acked immediately by omp; turn completion arrives via the
    // agent_end event forwarded above. Resolve bb once the prompt is sent.
    void sendOmpCommand({ type: "prompt", message }).catch((error) => {
      // omp rejecting the command or a broken-stdin write would otherwise hang
      // the turn silently — surface it so the adapter can fail the turn.
      const detail = error instanceof Error ? error.message : String(error);
      sendNotification("error", {
        threadId: currentThreadId ?? "",
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
  const message = flattenPromptInputToMessage(params.input);
  try {
    await ensureOmp();
    void sendOmpCommand({ type: "steer", message }).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      sendNotification("error", {
        threadId: currentThreadId ?? "",
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
  try {
    await ensureOmp();
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
    case "thread/resume":
      await handleThreadStart(id, params);
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
  const pending = [...pendingOmpRequests.values()];
  pendingOmpRequests.clear();
  for (const request of pending) {
    request.reject(new Error("bb bridge stdin closed"));
  }
  if (ompChild) {
    ompChild.kill();
  }
  process.exit(0);
});
