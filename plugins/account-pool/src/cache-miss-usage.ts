import { z } from "zod";
import type { CacheMissUsage, PoolProvider } from "./contracts.js";

const MAX_BUFFERED_LENGTH = 16 * 1024 * 1024;
const USAGE_EVENT_MARKERS = [
  "message_start",
  "message_delta",
  "response.completed",
  "response.incomplete",
] as const;

export type PromptUsage = CacheMissUsage;

export interface UsageTap {
  push(bytes: Uint8Array): void;
  finish(): PromptUsage | null;
}

interface UsageAccumulator {
  event(payload: unknown): void;
  body(payload: unknown): void;
  result(): PromptUsage | null;
}

const optionalTokenCount = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .catch(undefined);

const claudeUsageSchema = z
  .object({
    input_tokens: optionalTokenCount,
    cache_creation_input_tokens: optionalTokenCount,
    cache_read_input_tokens: optionalTokenCount,
  })
  .passthrough();

const claudeEventSchema = z
  .object({
    type: z.string(),
    message: z
      .object({ usage: claudeUsageSchema.nullish().catch(null) })
      .passthrough()
      .nullish()
      .catch(null),
    usage: claudeUsageSchema.nullish().catch(null),
  })
  .passthrough();

const claudeBodySchema = z
  .object({ usage: claudeUsageSchema.nullish().catch(null) })
  .passthrough();

const codexUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({
        cached_tokens: optionalTokenCount,
        cache_write_tokens: optionalTokenCount,
      })
      .passthrough()
      .nullish()
      .catch(null),
  })
  .passthrough();

const codexEventSchema = z
  .object({
    type: z.string(),
    response: z
      .object({ usage: codexUsageSchema.nullish().catch(null) })
      .passthrough()
      .nullish()
      .catch(null),
  })
  .passthrough();

const codexBodySchema = z
  .object({ usage: codexUsageSchema.nullish().catch(null) })
  .passthrough();

export function createUsageTap(
  provider: PoolProvider,
  contentType: string | null,
): UsageTap {
  const accumulator =
    provider === "claude" ? claudeAccumulator() : codexAccumulator();
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "text/event-stream"
    ? eventStreamTap(accumulator)
    : jsonTap(accumulator);
}

function claudeAccumulator(): UsageAccumulator {
  let input: number | undefined;
  let creation: number | undefined;
  let read: number | undefined;
  const merge = (
    usage: z.infer<typeof claudeUsageSchema> | null | undefined,
  ): void => {
    if (usage === null || usage === undefined) return;
    input = usage.input_tokens ?? input;
    creation = usage.cache_creation_input_tokens ?? creation;
    read = usage.cache_read_input_tokens ?? read;
  };
  return {
    event(payload) {
      const parsed = claudeEventSchema.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data.type === "message_start")
        merge(parsed.data.message?.usage);
      else if (parsed.data.type === "message_delta") merge(parsed.data.usage);
    },
    body(payload) {
      const parsed = claudeBodySchema.safeParse(payload);
      if (parsed.success) merge(parsed.data.usage);
    },
    result() {
      if (input === undefined) return null;
      return {
        promptTokens: input + (creation ?? 0) + (read ?? 0),
        cacheReadTokens: read ?? 0,
        cacheWriteTokens: creation ?? null,
      };
    },
  };
}

function codexAccumulator(): UsageAccumulator {
  let usage: PromptUsage | null = null;
  const record = (
    value: z.infer<typeof codexUsageSchema> | null | undefined,
  ): void => {
    if (value === null || value === undefined) return;
    usage = {
      promptTokens: value.input_tokens,
      cacheReadTokens: value.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: value.input_tokens_details?.cache_write_tokens ?? null,
    };
  };
  return {
    event(payload) {
      const parsed = codexEventSchema.safeParse(payload);
      if (
        parsed.success &&
        (parsed.data.type === "response.completed" ||
          parsed.data.type === "response.incomplete")
      )
        record(parsed.data.response?.usage);
    },
    body(payload) {
      const parsed = codexBodySchema.safeParse(payload);
      if (parsed.success) record(parsed.data.usage);
    },
    result: () => usage,
  };
}

function eventStreamTap(accumulator: UsageAccumulator): UsageTap {
  const decoder = new TextDecoder();
  let line = "";
  let discardingLine = false;
  let data: string[] = [];
  let dataLength = 0;
  let skippingEvent = false;

  const dispatch = (): void => {
    const payload = skippingEvent || data.length === 0 ? null : data.join("\n");
    data = [];
    dataLength = 0;
    skippingEvent = false;
    if (
      payload === null ||
      !USAGE_EVENT_MARKERS.some((marker) => payload.includes(marker))
    )
      return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    accumulator.event(parsed);
  };
  const processLine = (raw: string): void => {
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (value === "") {
      dispatch();
      return;
    }
    if (skippingEvent || !value.startsWith("data:")) return;
    const field = value.startsWith("data: ") ? value.slice(6) : value.slice(5);
    dataLength += field.length + 1;
    data.push(field);
  };
  const consume = (text: string): void => {
    let start = 0;
    while (true) {
      const newline = text.indexOf("\n", start);
      const end = newline < 0 ? text.length : newline;
      if (!discardingLine) {
        if (line.length + (end - start) + dataLength > MAX_BUFFERED_LENGTH) {
          discardingLine = true;
          skippingEvent = true;
          line = "";
          data = [];
          dataLength = 0;
        } else if (end > start) {
          line += text.slice(start, end);
        }
      }
      if (newline < 0) return;
      if (discardingLine) discardingLine = false;
      else processLine(line);
      line = "";
      start = newline + 1;
    }
  };

  return {
    push(bytes) {
      consume(decoder.decode(bytes, { stream: true }));
    },
    finish() {
      consume(decoder.decode());
      if (!discardingLine && line !== "") processLine(line);
      line = "";
      dispatch();
      return accumulator.result();
    },
  };
}

function jsonTap(accumulator: UsageAccumulator): UsageTap {
  let chunks: Uint8Array[] = [];
  let length = 0;
  let overflowed = false;
  return {
    push(bytes) {
      if (overflowed) return;
      length += bytes.byteLength;
      if (length > MAX_BUFFERED_LENGTH) {
        overflowed = true;
        chunks = [];
        return;
      }
      chunks.push(bytes.slice());
    },
    finish() {
      if (overflowed || length === 0) return null;
      const body = Buffer.concat(chunks, length);
      chunks = [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return null;
      }
      accumulator.body(parsed);
      return accumulator.result();
    },
  };
}
