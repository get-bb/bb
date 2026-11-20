import {
  getExperiments,
  getLatestTokenUsageRow,
  getPromptCacheRequestStartAt,
  type DbConnection,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { parseStoredEvent } from "./thread-data.js";

export const COMPACTION_MIN_TOKENS = 100_000;
export const IDLE_COMPACTION_LEAD_MS = 2 * 60_000;
export const IDLE_COMPACTION_MIN_TTL_MS = 60 * 60_000;

interface CompactionOfferDeps {
  db: DbConnection;
  providerRegistry: Pick<ProviderRegistryService, "supportsManualCompaction">;
}

export function isCompactionOfferEnabled(
  deps: CompactionOfferDeps,
  providerId: string,
): boolean {
  return (
    getExperiments(deps.db).compactExpiredCache &&
    deps.providerRegistry.supportsManualCompaction(providerId)
  );
}

export function isIdleCompactionThread(
  thread: Pick<Thread, "parentThreadId" | "visibility">,
): boolean {
  return thread.parentThreadId === null && thread.visibility === "visible";
}

export interface PromptCacheExpiry {
  expiresAt: number;
  ttlMs: number;
}

export function readPromptCacheExpiry(
  db: DbConnection,
  args: { sequenceStart: number; threadId: string },
): PromptCacheExpiry | null {
  const row = getLatestTokenUsageRow(db, args);
  if (row === null) return null;
  const event = parseStoredEvent(row);
  if (
    event.type !== "thread/tokenUsage/updated" ||
    event.tokenUsage.promptCacheTtlMs === undefined
  ) {
    return null;
  }
  const requestStartedAt =
    row.turnId === null
      ? null
      : getPromptCacheRequestStartAt(db, {
          beforeSequence: row.sequence,
          threadId: args.threadId,
          turnId: row.turnId,
        });
  const ttlMs = event.tokenUsage.promptCacheTtlMs;
  return { expiresAt: (requestStartedAt ?? row.createdAt) + ttlMs, ttlMs };
}

interface WithCompactionOfferArgs {
  enabled: boolean;
  idleCompactionEligible: boolean;
  sequenceStart: number;
  threadId: string;
  usage: ThreadContextWindowUsage;
}

export function withCompactionOffer(
  db: DbConnection,
  args: WithCompactionOfferArgs,
): ThreadContextWindowUsage {
  if (!args.enabled || args.usage.usedTokens < COMPACTION_MIN_TOKENS) {
    return args.usage;
  }
  const expiry = readPromptCacheExpiry(db, args);
  if (expiry === null) return args.usage;
  return {
    ...args.usage,
    compactionOfferAt: new Date(expiry.expiresAt).toISOString(),
    ...(args.idleCompactionEligible &&
    expiry.ttlMs >= IDLE_COMPACTION_MIN_TTL_MS
      ? {
          idleCompactionAt: new Date(
            expiry.expiresAt - IDLE_COMPACTION_LEAD_MS,
          ).toISOString(),
        }
      : {}),
  };
}
