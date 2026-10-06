import {
  type AiRequestOutcome,
  type ConnectDb,
  aiRequestLog,
  resolveServerCredential,
  serverCredentialFromHeaders,
  sha256Hex,
} from "@bb/connect-db";
import type { GatewayConfig } from "./config.js";
import {
  type BudgetKey,
  RESERVE_MICROS,
  TRANSCRIBE_RESERVE_MICROS,
  nextUtcMidnight,
  reserveBudget,
  settleBudget,
  spentMicros,
  utcDay,
} from "./metering.js";
import {
  type TranscribeFormat,
  type TranscribeInput,
  type UpstreamFetch,
  type UpstreamResult,
  callTranscribe,
  callUpstream,
  transcribeFormats,
} from "./upstream.js";

export const MAX_PROMPT_BYTES = 48 * 1024;
const MAX_BODY_BYTES = 512 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_HINT_BYTES = 4 * 1024;
const MAX_TRANSCRIBE_BODY_BYTES = 14 * 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

export const COMPLETE_PATH = "/api/ai/v1/complete";
export const TRANSCRIBE_PATH = "/api/ai/v1/transcribe";
export const USAGE_PATH = "/api/ai/v1/usage";

type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "budget_exhausted"
  | "rate_limited"
  | "unavailable"
  | "timeout";

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  budget_exhausted: 402,
  rate_limited: 429,
  unavailable: 503,
  timeout: 504,
};

export interface GatewayDeps {
  db: ConnectDb;
  config: GatewayConfig;
  rateLimiter: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  fetch: UpstreamFetch;
  now: () => number;
  upstreamTimeoutMs: number;
  transcribeTimeoutMs: number;
  waitUntil: (promise: Promise<unknown>) => void;
}

function errorResponse(
  code: ErrorCode,
  message: string,
  extra: { resetsAt?: number } = {},
  status: number = ERROR_STATUS[code],
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

async function authenticate(request: Request, db: ConnectDb) {
  return resolveServerCredential(
    db,
    serverCredentialFromHeaders(request.headers),
  );
}

const BODY_TOO_LARGE = "request body is too large";

async function readBody(
  request: Request,
  maxBytes: number,
): Promise<{ text: string } | { error: string }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: BODY_TOO_LARGE };
  }
  if (request.body === null) return { text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { error: BODY_TOO_LARGE };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "request body could not be read" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

async function readJson(
  request: Request,
  maxBytes: number,
): Promise<Parsed<unknown>> {
  const read = await readBody(request, maxBytes);
  if ("error" in read) return { ok: false, error: read.error };
  try {
    return { ok: true, value: JSON.parse(read.text) };
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }
}

function bodyField(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null
    ? Reflect.get(body, key)
    : undefined;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parsePrompt(body: unknown): Parsed<string> {
  const prompt = bodyField(body, "prompt");
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, error: "prompt must be a non-empty string" };
  }
  if (utf8Bytes(prompt) > MAX_PROMPT_BYTES) {
    return { ok: false, error: `prompt exceeds ${MAX_PROMPT_BYTES} bytes` };
  }
  return { ok: true, value: prompt };
}

function base64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function isTranscribeFormat(value: unknown): value is TranscribeFormat {
  return transcribeFormats.some((format) => format === value);
}

function parseTranscribe(body: unknown): Parsed<TranscribeInput> {
  const audio = bodyField(body, "audio");
  if (
    typeof audio !== "string" ||
    audio.length === 0 ||
    audio.length % 4 !== 0 ||
    !BASE64_PATTERN.test(audio)
  ) {
    return { ok: false, error: "audio must be non-empty base64" };
  }
  if (base64DecodedBytes(audio) > MAX_AUDIO_BYTES) {
    return { ok: false, error: `audio exceeds ${MAX_AUDIO_BYTES} bytes` };
  }
  const format = bodyField(body, "format");
  if (!isTranscribeFormat(format)) {
    return {
      ok: false,
      error: `format must be one of ${transcribeFormats.join(", ")}`,
    };
  }
  const rawHint = bodyField(body, "hint") ?? null;
  if (rawHint !== null && typeof rawHint !== "string") {
    return { ok: false, error: "hint must be a string or null" };
  }
  const hint = rawHint?.trim() ?? "";
  if (utf8Bytes(hint) > MAX_HINT_BYTES) {
    return { ok: false, error: `hint exceeds ${MAX_HINT_BYTES} bytes` };
  }
  return {
    ok: true,
    value: { audio, format, hint: hint.length > 0 ? hint : null },
  };
}

async function logRequest(
  deps: GatewayDeps,
  entry: {
    userId: string;
    serverId: string;
    model: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    costMicros: number;
    startedAt: number;
    outcome: AiRequestOutcome;
  },
): Promise<void> {
  const finishedAt = deps.now();
  try {
    await deps.db
      .insert(aiRequestLog)
      .values({
        id: crypto.randomUUID(),
        userId: entry.userId,
        serverId: entry.serverId,
        model: entry.model,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        costMicros: entry.costMicros,
        latencyMs: Math.max(0, finishedAt - entry.startedAt),
        outcome: entry.outcome,
        createdAt: new Date(finishedAt),
      })
      .run();
  } catch (error) {
    console.error("bb ai gateway: request log write failed", error);
  }
}

function chargedMicros(result: UpstreamResult, reserveMicros: number): number {
  if (result.costMicros !== null) return result.costMicros;
  return result.kind === "ok" || result.mayBill ? reserveMicros : 0;
}

type LogBase = { userId: string; serverId: string; startedAt: number };

const NO_USAGE = {
  model: null,
  promptTokens: null,
  completionTokens: null,
  costMicros: 0,
};

interface MeteredTask<T> {
  maxBodyBytes: number;
  reserveMicros: number;
  parse(body: unknown): Parsed<T>;
  call(
    deps: GatewayDeps,
    apiKey: string,
    input: T,
    userId: string,
  ): Promise<UpstreamResult>;
}

const completeTask: MeteredTask<string> = {
  maxBodyBytes: MAX_BODY_BYTES,
  reserveMicros: RESERVE_MICROS,
  parse: parsePrompt,
  call: async (deps, apiKey, prompt, userId) =>
    callUpstream({
      fetch: deps.fetch,
      config: deps.config,
      apiKey,
      prompt,
      userHash: await sha256Hex(userId),
      timeoutMs: deps.upstreamTimeoutMs,
    }),
};

const transcribeTask: MeteredTask<TranscribeInput> = {
  maxBodyBytes: MAX_TRANSCRIBE_BODY_BYTES,
  reserveMicros: TRANSCRIBE_RESERVE_MICROS,
  parse: parseTranscribe,
  call: (deps, apiKey, input) =>
    callTranscribe({
      fetch: deps.fetch,
      config: deps.config,
      apiKey,
      input,
      timeoutMs: deps.transcribeTimeoutMs,
    }),
};

async function runReserved<T>(
  deps: GatewayDeps,
  task: MeteredTask<T>,
  args: {
    base: LogBase;
    key: BudgetKey;
    apiKey: string;
    input: T;
  },
): Promise<Response> {
  let result: UpstreamResult | null = null;
  let spentTodayMicros = 0;
  try {
    result = await task.call(deps, args.apiKey, args.input, args.base.userId);
  } finally {
    const costMicros =
      result === null
        ? task.reserveMicros
        : chargedMicros(result, task.reserveMicros);
    ({ spentTodayMicros } = await settleBudget(
      deps.db,
      args.key,
      costMicros,
      task.reserveMicros,
    ));
  }
  const costMicros = chargedMicros(result, task.reserveMicros);
  await logRequest(deps, {
    ...args.base,
    model: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costMicros,
    outcome: result.kind === "ok" ? "ok" : result.reason,
  });

  if (result.kind === "error") {
    return result.reason === "timeout"
      ? errorResponse("timeout", "the model did not answer in time")
      : errorResponse("unavailable", "the model is unavailable; try later");
  }
  return Response.json({
    text: result.text,
    model: result.model,
    usage: {
      costMicros,
      spentTodayMicros,
      limitMicros: deps.config.dailyBudgetMicros,
    },
  });
}

async function handleMetered<T>(
  request: Request,
  deps: GatewayDeps,
  task: MeteredTask<T>,
): Promise<Response> {
  const startedAt = deps.now();
  const account = await authenticate(request, deps.db);
  if (!account) {
    return errorResponse("unauthorized", "sign in to your bb account");
  }
  const base: LogBase = {
    userId: account.userId,
    serverId: account.server.id,
    startedAt,
  };
  const limited = await deps.rateLimiter.limit({ key: account.userId });
  if (!limited.success) {
    await logRequest(deps, { ...base, ...NO_USAGE, outcome: "rate_limited" });
    return errorResponse("rate_limited", "too many requests; slow down");
  }

  const body = await readJson(request, task.maxBodyBytes);
  const parsed = body.ok ? task.parse(body.value) : body;
  if (!parsed.ok) {
    await logRequest(deps, {
      ...base,
      ...NO_USAGE,
      outcome: "invalid_request",
    });
    return errorResponse("invalid_request", parsed.error);
  }
  const apiKey = deps.config.apiKey;
  if (apiKey === null) {
    await logRequest(deps, { ...base, ...NO_USAGE, outcome: "unavailable" });
    return errorResponse("unavailable", "hosted generation is not configured");
  }

  const key = { userId: account.userId, day: utcDay(startedAt) };
  const reserved = await reserveBudget(
    deps.db,
    key,
    deps.config.dailyBudgetMicros,
    task.reserveMicros,
  );
  if (!reserved) {
    await logRequest(deps, {
      ...base,
      ...NO_USAGE,
      outcome: "budget_exhausted",
    });
    return errorResponse("budget_exhausted", "daily limit reached", {
      resetsAt: nextUtcMidnight(startedAt),
    });
  }

  const response = runReserved(deps, task, {
    base,
    key,
    apiKey,
    input: parsed.value,
  });
  deps.waitUntil(response.catch(() => {}));
  return response;
}

export function handleComplete(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  return handleMetered(request, deps, completeTask);
}

export function handleTranscribe(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  return handleMetered(request, deps, transcribeTask);
}

export async function handleUsage(
  request: Request,
  deps: Pick<GatewayDeps, "db" | "config" | "now">,
): Promise<Response> {
  const account = await authenticate(request, deps.db);
  if (!account) {
    return errorResponse("unauthorized", "sign in to your bb account");
  }
  const now = deps.now();
  const day = utcDay(now);
  return Response.json({
    day,
    spentMicros: await spentMicros(deps.db, { userId: account.userId, day }),
    limitMicros: deps.config.dailyBudgetMicros,
    resetsAt: nextUtcMidnight(now),
  });
}

export async function routeGatewayRequest(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === COMPLETE_PATH) {
    if (request.method !== "POST") {
      return errorResponse("invalid_request", "use POST", {}, 405);
    }
    return handleComplete(request, deps);
  }
  if (pathname === TRANSCRIBE_PATH) {
    if (request.method !== "POST") {
      return errorResponse("invalid_request", "use POST", {}, 405);
    }
    return handleTranscribe(request, deps);
  }
  if (pathname === USAGE_PATH) {
    if (request.method !== "GET") {
      return errorResponse("invalid_request", "use GET", {}, 405);
    }
    return handleUsage(request, deps);
  }
  return errorResponse("invalid_request", "not found", {}, 404);
}

export function unavailableResponse(message: string): Response {
  return errorResponse("unavailable", message);
}
