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
  RESERVE_MICROS,
  nextUtcMidnight,
  reserveBudget,
  settleBudget,
  spentMicros,
  utcDay,
} from "./metering.js";
import { type UpstreamFetch, callUpstream } from "./upstream.js";

export const MAX_PROMPT_BYTES = 48 * 1024;
const MAX_BODY_BYTES = 512 * 1024;

export const COMPLETE_PATH = "/api/ai/v1/complete";
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

async function readPrompt(
  request: Request,
): Promise<{ prompt: string } | { error: string }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { error: "request body is too large" };
  }
  const raw = await request.text().catch(() => null);
  if (
    raw === null ||
    new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES
  ) {
    return { error: "request body is too large" };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: "request body must be JSON" };
  }
  const prompt =
    typeof body === "object" && body !== null
      ? Reflect.get(body, "prompt")
      : undefined;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return { error: "prompt must be a non-empty string" };
  }
  if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
    return { error: `prompt exceeds ${MAX_PROMPT_BYTES} bytes` };
  }
  return { prompt };
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

export async function handleComplete(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  const startedAt = deps.now();
  const account = await authenticate(request, deps.db);
  if (!account) {
    return errorResponse("unauthorized", "sign in to your bb account");
  }
  const limited = await deps.rateLimiter.limit({ key: account.userId });
  if (!limited.success) {
    return errorResponse("rate_limited", "too many requests; slow down");
  }

  const base = {
    userId: account.userId,
    serverId: account.server.id,
    startedAt,
  };
  const noUsage = {
    model: null,
    promptTokens: null,
    completionTokens: null,
    costMicros: 0,
  };
  const parsed = await readPrompt(request);
  if ("error" in parsed) {
    await logRequest(deps, { ...base, ...noUsage, outcome: "invalid_request" });
    return errorResponse("invalid_request", parsed.error);
  }
  const apiKey = deps.config.apiKey;
  if (apiKey === null) {
    await logRequest(deps, { ...base, ...noUsage, outcome: "unavailable" });
    return errorResponse("unavailable", "hosted generation is not configured");
  }

  const key = { userId: account.userId, day: utcDay(startedAt) };
  const reserved = await reserveBudget(
    deps.db,
    key,
    deps.config.dailyBudgetMicros,
  );
  if (!reserved) {
    await logRequest(deps, {
      ...base,
      ...noUsage,
      outcome: "budget_exhausted",
    });
    return errorResponse("budget_exhausted", "daily limit reached", {
      resetsAt: nextUtcMidnight(startedAt),
    });
  }

  const result = await callUpstream({
    fetch: deps.fetch,
    config: deps.config,
    apiKey,
    prompt: parsed.prompt,
    userHash: await sha256Hex(account.userId),
    timeoutMs: deps.upstreamTimeoutMs,
  });
  const costMicros =
    result.costMicros ?? (result.kind === "ok" ? RESERVE_MICROS : 0);
  const { spentTodayMicros } = await settleBudget(deps.db, key, costMicros);
  await logRequest(deps, {
    ...base,
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
