import type { GatewayConfig } from "./config.js";

export const MAX_OUTPUT_TOKENS = 128;
export const UPSTREAM_TIMEOUT_MS = 4_000;
export const TRANSCRIBE_TIMEOUT_MS = 8_000;
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
      mayBill: boolean;
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

function upstreamHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "HTTP-Referer": "https://getbb.app",
    "X-Title": "bb",
  };
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
    return {
      kind: "error",
      reason: "upstream_error",
      model,
      mayBill: true,
      ...usage,
    };
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
        headers: upstreamHeaders(args.apiKey),
        body: JSON.stringify(
          buildUpstreamRequest(args.config, args.prompt, args.userHash),
        ),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (timedOut) {
      return {
        kind: "error",
        reason: "timeout",
        model: null,
        mayBill: true,
        ...NO_USAGE,
      };
    }
    if (!response.ok) {
      return {
        kind: "error",
        reason: "upstream_error",
        model: null,
        mayBill: false,
        ...readUsage(body),
      };
    }
    return parseUpstreamResponse(body);
  } catch {
    return {
      kind: "error",
      reason: timedOut ? "timeout" : "upstream_error",
      model: null,
      mayBill: true,
      ...NO_USAGE,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const transcribeFormats = [
  "wav",
  "mp3",
  "flac",
  "m4a",
  "ogg",
  "webm",
  "aac",
] as const;
export type TranscribeFormat = (typeof transcribeFormats)[number];

export interface TranscribeInput {
  audio: string;
  format: TranscribeFormat;
  hint: string | null;
}

export function buildTranscribeRequest(
  model: string,
  input: TranscribeInput,
): Record<string, unknown> {
  const options =
    input.hint === null ? {} : { options: { groq: { prompt: input.hint } } };
  return {
    model,
    input_audio: { data: input.audio, format: input.format },
    provider: { zdr: true, data_collection: "deny", ...options },
  };
}

function readTranscribeUsage(body: unknown): UpstreamUsage {
  const usage = field(body, "usage");
  return {
    costMicros: creditsToMicros(field(usage, "cost")),
    promptTokens: nonNegativeInteger(field(usage, "input_tokens")),
    completionTokens: nonNegativeInteger(field(usage, "output_tokens")),
  };
}

async function transcribeOnce(args: {
  fetch: UpstreamFetch;
  config: GatewayConfig;
  apiKey: string;
  model: string;
  input: TranscribeInput;
  signal: AbortSignal;
}): Promise<UpstreamResult> {
  try {
    const response = await args.fetch(
      `${args.config.upstreamBaseUrl}/audio/transcriptions`,
      {
        method: "POST",
        signal: args.signal,
        headers: upstreamHeaders(args.apiKey),
        body: JSON.stringify(buildTranscribeRequest(args.model, args.input)),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    const usage = readTranscribeUsage(body);
    if (args.signal.aborted) {
      return {
        kind: "error",
        reason: "timeout",
        model: args.model,
        mayBill: true,
        ...usage,
      };
    }
    const text = field(body, "text");
    if (!response.ok || typeof text !== "string") {
      return {
        kind: "error",
        reason: "upstream_error",
        model: args.model,
        mayBill: response.ok,
        ...usage,
      };
    }
    return { kind: "ok", text, model: args.model, ...usage };
  } catch {
    return {
      kind: "error",
      reason: args.signal.aborted ? "timeout" : "upstream_error",
      model: args.model,
      mayBill: true,
      ...NO_USAGE,
    };
  }
}

function billable(result: UpstreamResult): boolean {
  return result.kind === "ok" || result.mayBill;
}

export async function callTranscribe(args: {
  fetch: UpstreamFetch;
  config: GatewayConfig;
  apiKey: string;
  input: TranscribeInput;
  timeoutMs: number;
}): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  let knownCost: number | null = null;
  let last: UpstreamResult | null = null;
  try {
    for (const model of args.config.transcribeModels) {
      last = await transcribeOnce({
        ...args,
        model,
        signal: controller.signal,
      });
      if (last.costMicros !== null) {
        knownCost = (knownCost ?? 0) + last.costMicros;
      }
      if (billable(last) || controller.signal.aborted) break;
    }
  } finally {
    clearTimeout(timer);
  }
  if (last === null) throw new Error("no transcription model is configured");
  return {
    ...last,
    costMicros: last.costMicros === null && billable(last) ? null : knownCost,
  };
}
