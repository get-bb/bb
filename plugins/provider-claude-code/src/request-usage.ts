import { z } from "zod";
import {
  addTokenUsage,
  ZERO_TOKEN_USAGE,
  type ThreadDelta,
  type ThreadEventTokenUsageBreakdown,
} from "@get-bb/plugin-sdk/provider-bridge";

const tokens = z.number().int().nonnegative().safe();
const cacheWriteBreakdownSchema = z.object({
  fiveMinuteTokens: tokens.nullable(),
  oneHourTokens: tokens.nullable(),
  unknownTokens: tokens,
});
type CacheWriteBreakdown = z.infer<typeof cacheWriteBreakdownSchema>;
const cacheCreationSchema = z.object({
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: tokens.optional(),
      ephemeral_1h_input_tokens: tokens.optional(),
    })
    .nullish(),
});

export const usageMetadataSchema = z.object({
  source: z.enum(["request", "aggregate-remainder"]),
  messageId: z.string().nullable(),
  model: z.string().nullable(),
  incomplete: z.boolean(),
  counts: z.record(z.string(), z.number().nonnegative()),
  cacheWriteBreakdown: cacheWriteBreakdownSchema.nullable().optional(),
});

function normalizeCacheWrites(
  write: number,
  five: number | null,
  hour: number | null,
): CacheWriteBreakdown {
  if (write === 0)
    return { fiveMinuteTokens: 0, oneHourTokens: 0, unknownTokens: 0 };
  const known = (five ?? 0) + (hour ?? 0);
  return known <= write
    ? {
        fiveMinuteTokens: five,
        oneHourTokens: hour,
        unknownTokens: write - known,
      }
    : { fiveMinuteTokens: null, oneHourTokens: null, unknownTokens: write };
}

function cacheWrites(
  usage: unknown,
  write: number | undefined,
  previous?: CacheWriteBreakdown,
): CacheWriteBreakdown | null {
  if (write === undefined) return null;
  const parsed = cacheCreationSchema.safeParse(usage);
  const creation = parsed.success ? parsed.data.cache_creation : undefined;
  const merge = (
    value: number | undefined,
    prior: number | null | undefined,
  ) => (value === undefined ? (prior ?? null) : Math.max(value, prior ?? 0));
  return normalizeCacheWrites(
    write,
    merge(creation?.ephemeral_5m_input_tokens, previous?.fiveMinuteTokens),
    merge(creation?.ephemeral_1h_input_tokens, previous?.oneHourTokens),
  );
}

const assistantUsage = z.object({
  id: z.string().min(1),
  model: z.string().optional(),
  usage: z.object({
    input_tokens: tokens,
    output_tokens: tokens,
    cache_read_input_tokens: tokens,
    cache_creation_input_tokens: tokens,
    cache_creation: z
      .object({
        ephemeral_1h_input_tokens: tokens.optional(),
        ephemeral_5m_input_tokens: tokens.optional(),
      })
      .nullish(),
  }),
});
const fields = [
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
  "reasoningOutputTokens",
  "totalTokens",
] as const;
type Breakdown = ThreadEventTokenUsageBreakdown;

export class ClaudeRequestUsage {
  private seen = new Set<string>();
  private pending:
    | {
        id: string;
        model?: string;
        counts: Breakdown;
        ttl?: number;
        cacheWrites: CacheWriteBreakdown;
      }
    | undefined;
  private turn: Breakdown = ZERO_TOKEN_USAGE;
  private turnCacheWrites = {
    fiveMinuteTokens: 0,
    oneHourTokens: 0,
    unknownTokens: 0,
  };

  resetTurn() {
    this.seen.clear();
    this.pending = undefined;
    this.turn = ZERO_TOKEN_USAGE;
    this.turnCacheWrites = {
      fiveMinuteTokens: 0,
      oneHourTokens: 0,
      unknownTokens: 0,
    };
  }

  observe(
    message: unknown,
    total: Breakdown,
    contextWindow: number | null,
  ): ThreadDelta[] {
    const parsed = assistantUsage.safeParse(message);
    if (!parsed.success || this.seen.has(parsed.data.id)) return [];
    const { id, model, usage } = parsed.data;
    if (model === "<synthetic>") return [];
    const deltas =
      this.pending && this.pending.id !== id
        ? this.flush(total, contextWindow)
        : [];
    const read = usage.cache_read_input_tokens;
    const write = usage.cache_creation_input_tokens;
    const counts: Breakdown = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedInputTokens: read + write,
      cacheReadInputTokens: read,
      cacheWriteInputTokens: write,
      totalTokens: usage.input_tokens + usage.output_tokens + read + write,
      reasoningOutputTokens: 0,
    };
    if (this.pending?.id === id) {
      for (const field of fields)
        counts[field] = Math.max(
          counts[field] ?? 0,
          this.pending.counts[field] ?? 0,
        );
    }
    const ttl =
      (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0
        ? 3_600_000
        : (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0
          ? 300_000
          : this.pending?.ttl;
    const breakdown =
      cacheWrites(
        usage,
        counts.cacheWriteInputTokens,
        this.pending?.id === id ? this.pending.cacheWrites : undefined,
      ) ?? normalizeCacheWrites(write, null, null);
    this.pending = { id, model, counts, ttl, cacheWrites: breakdown };
    return deltas;
  }

  flush(
    total: Breakdown,
    contextWindow: number | null,
    incomplete = false,
  ): ThreadDelta[] {
    const pending = this.pending;
    if (!pending) return [];
    this.pending = undefined;
    this.seen.add(pending.id);
    this.turn = addTokenUsage(this.turn, pending.counts);
    this.turnCacheWrites.fiveMinuteTokens +=
      pending.cacheWrites.fiveMinuteTokens ?? 0;
    this.turnCacheWrites.oneHourTokens +=
      pending.cacheWrites.oneHourTokens ?? 0;
    this.turnCacheWrites.unknownTokens += pending.cacheWrites.unknownTokens;
    return this.report(
      total,
      pending.counts,
      contextWindow,
      {
        source: "request",
        messageId: pending.id,
        model: pending.model ?? null,
        incomplete,
      },
      pending.ttl,
      pending.cacheWrites,
    );
  }

  reconcile(
    total: Breakdown,
    aggregate: Breakdown,
    contextWindow: number | null,
    ttl?: number,
    aggregateUsage?: unknown,
  ): ThreadDelta[] {
    const residual = { ...aggregate };
    for (const field of fields) {
      const reported = aggregate[field];
      if (reported !== undefined)
        residual[field] = Math.max(0, reported - (this.turn[field] ?? 0));
    }
    residual.cachedInputTokens = Math.max(
      residual.cachedInputTokens,
      (residual.cacheReadInputTokens ?? 0) +
        (residual.cacheWriteInputTokens ?? 0),
    );
    residual.totalTokens =
      residual.inputTokens + residual.outputTokens + residual.cachedInputTokens;
    if (
      this.seen.size > 0 &&
      !fields.some((field) => (residual[field] ?? 0) > 0)
    )
      return [];
    const aggregateWrites = cacheWrites(
      aggregateUsage,
      aggregate.cacheWriteInputTokens,
    );
    let remainderWrites = cacheWrites(
      undefined,
      residual.cacheWriteInputTokens,
    );
    if (
      aggregateWrites &&
      remainderWrites &&
      residual.cacheWriteInputTokens !== undefined &&
      this.turnCacheWrites.unknownTokens === 0
    ) {
      const five =
        aggregateWrites.fiveMinuteTokens === null
          ? null
          : aggregateWrites.fiveMinuteTokens -
            this.turnCacheWrites.fiveMinuteTokens;
      const hour =
        aggregateWrites.oneHourTokens === null
          ? null
          : aggregateWrites.oneHourTokens - this.turnCacheWrites.oneHourTokens;
      if ((five === null || five >= 0) && (hour === null || hour >= 0))
        remainderWrites = normalizeCacheWrites(
          residual.cacheWriteInputTokens,
          five,
          hour,
        );
    }
    return this.report(
      total,
      residual,
      contextWindow,
      {
        source: "aggregate-remainder",
        messageId: null,
        model: null,
        incomplete: true,
      },
      ttl,
      remainderWrites,
    );
  }

  private report(
    total: Breakdown,
    last: Breakdown,
    modelContextWindow: number | null,
    metadata: Record<string, string | boolean | null>,
    ttl?: number,
    cacheWriteBreakdown: CacheWriteBreakdown | null = null,
  ): ThreadDelta[] {
    return [
      {
        kind: "extension.state",
        extensionKind: "provider-claude-code/usage",
        payload: { ...metadata, counts: last, cacheWriteBreakdown },
      },
      {
        kind: "usage",
        total: addTokenUsage(total, last),
        last,
        modelContextWindow,
        ...(ttl === undefined ? {} : { promptCacheTtlMs: ttl }),
      },
    ];
  }
}
