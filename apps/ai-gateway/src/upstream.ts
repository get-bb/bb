import type { GatewayConfig } from "./config.js";

export const MAX_OUTPUT_TOKENS = 128;
export const UPSTREAM_TIMEOUT_MS = 3_000;
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
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
  model: string,
  prompt: string,
  userHash: string,
): Record<string, unknown> {
  return {
    model,
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

async function completeOnce(args: {
  fetch: UpstreamFetch;
  config: GatewayConfig;
  apiKey: string;
  model: string;
  prompt: string;
  userHash: string;
  signal: AbortSignal;
}): Promise<UpstreamResult> {
  try {
    const response = await args.fetch(
      `${args.config.upstreamBaseUrl}/chat/completions`,
      {
        method: "POST",
        signal: args.signal,
        headers: upstreamHeaders(args.apiKey),
        body: JSON.stringify(
          buildUpstreamRequest(args.model, args.prompt, args.userHash),
        ),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (args.signal.aborted) {
      return {
        kind: "error",
        reason: "timeout",
        model: args.model,
        mayBill: true,
        ...NO_USAGE,
      };
    }
    if (!response.ok) {
      return {
        kind: "error",
        reason: "upstream_error",
        model: args.model,
        mayBill: false,
        ...readUsage(body),
      };
    }
    return parseUpstreamResponse(body);
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

export function callUpstream(args: {
  fetch: UpstreamFetch;
  config: GatewayConfig;
  apiKey: string;
  prompt: string;
  userHash: string;
  timeoutMs: number;
}): Promise<UpstreamResult> {
  return firstAnsweringModel(
    args.config.models,
    args.timeoutMs,
    (model, signal) => completeOnce({ ...args, model, signal }),
  );
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

async function firstAnsweringModel(
  models: string[],
  timeoutMs: number,
  attempt: (model: string, signal: AbortSignal) => Promise<UpstreamResult>,
): Promise<UpstreamResult> {
  let knownCost: number | null = null;
  let unknownBilledCost = false;
  let last: UpstreamResult | null = null;
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      last = await attempt(model, controller.signal);
    } finally {
      clearTimeout(timer);
    }
    if (last.costMicros !== null) {
      knownCost = (knownCost ?? 0) + last.costMicros;
    } else if (billable(last)) {
      unknownBilledCost = true;
    }
    if (last.kind === "ok") break;
  }
  if (last === null) throw new Error("no model is configured");
  return {
    ...last,
    ...(last.kind === "error"
      ? { mayBill: last.mayBill || unknownBilledCost }
      : {}),
    costMicros: unknownBilledCost ? null : knownCost,
  };
}

export function callTranscribe(args: {
  fetch: UpstreamFetch;
  config: GatewayConfig;
  apiKey: string;
  input: TranscribeInput;
  timeoutMs: number;
}): Promise<UpstreamResult> {
  return firstAnsweringModel(
    args.config.transcribeModels,
    args.timeoutMs,
    (model, signal) => transcribeOnce({ ...args, model, signal }),
  );
}
