import type { GatewayConfig } from "./config.js";

export const MAX_OUTPUT_TOKENS = 128;
export const UPSTREAM_TIMEOUT_MS = 8_000;
const TEMPERATURE = 0.2;

export type UpstreamFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface UpstreamUsage {
  costMicros: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export type UpstreamResult =
  | ({ kind: "ok"; text: string; model: string } & UpstreamUsage)
  | ({
      kind: "error";
      reason: "timeout" | "upstream_error";
      model: string | null;
    } & UpstreamUsage);

const NO_USAGE: UpstreamUsage = {
  costMicros: null,
  promptTokens: null,
  completionTokens: null,
};

export function buildUpstreamRequest(
  config: GatewayConfig,
  prompt: string,
  userHash: string,
): Record<string, unknown> {
  const [model, ...fallbacks] = config.models;
  return {
    model,
    ...(fallbacks.length > 0 ? { models: fallbacks } : {}),
    messages: [{ role: "user", content: prompt }],
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    reasoning: { effort: "none" },
    provider: { zdr: true, data_collection: "deny", sort: "latency" },
    user: userHash,
    stream: false,
  };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function creditsToMicros(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000_000)
    : null;
}

function readUsage(body: unknown): UpstreamUsage {
  const usage = field(body, "usage");
  return {
    costMicros: creditsToMicros(field(usage, "cost")),
    promptTokens: nonNegativeInteger(field(usage, "prompt_tokens")),
    completionTokens: nonNegativeInteger(field(usage, "completion_tokens")),
  };
}

export function parseUpstreamResponse(body: unknown): UpstreamResult {
  const usage = readUsage(body);
  const modelValue = field(body, "model");
  const model = typeof modelValue === "string" ? modelValue : null;
  const choices = field(body, "choices");
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const content = field(field(first, "message"), "content");
  if (typeof content !== "string" || model === null) {
    return { kind: "error", reason: "upstream_error", model, ...usage };
  }
  return { kind: "ok", text: content, model, ...usage };
}

export async function callUpstream(args: {
  fetch: UpstreamFetch;
  config: GatewayConfig;
  apiKey: string;
  prompt: string;
  userHash: string;
  timeoutMs: number;
}): Promise<UpstreamResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, args.timeoutMs);
  try {
    const response = await args.fetch(
      `${args.config.upstreamBaseUrl}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${args.apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": "https://getbb.app",
          "X-Title": "bb",
        },
        body: JSON.stringify(
          buildUpstreamRequest(args.config, args.prompt, args.userHash),
        ),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (timedOut) {
      return { kind: "error", reason: "timeout", model: null, ...NO_USAGE };
    }
    if (!response.ok) {
      return {
        kind: "error",
        reason: "upstream_error",
        model: null,
        ...readUsage(body),
      };
    }
    return parseUpstreamResponse(body);
  } catch {
    return {
      kind: "error",
      reason: timedOut ? "timeout" : "upstream_error",
      model: null,
      ...NO_USAGE,
    };
  } finally {
    clearTimeout(timer);
  }
}
