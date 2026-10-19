import {
  getExperiments,
  getLatestTokenUsageRow,
  type DbConnection,
} from "@bb/db";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { parseStoredEvent } from "./thread-data.js";

const COMPACTION_OFFER_MIN_TOKENS = 100_000;

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

interface WithCompactionOfferArgs {
  enabled: boolean;
  sequenceStart: number;
  threadId: string;
  usage: ThreadContextWindowUsage;
}

export function withCompactionOffer(
  db: DbConnection,
  args: WithCompactionOfferArgs,
): ThreadContextWindowUsage {
  if (!args.enabled || args.usage.usedTokens < COMPACTION_OFFER_MIN_TOKENS) {
    return args.usage;
  }
  const row = getLatestTokenUsageRow(db, {
    sequenceStart: args.sequenceStart,
    threadId: args.threadId,
  });
  if (row === null) return args.usage;
  const event = parseStoredEvent(row);
  if (
    event.type !== "thread/tokenUsage/updated" ||
    event.tokenUsage.promptCacheTtlMs === undefined
  ) {
    return args.usage;
  }
  return {
    ...args.usage,
    compactionOfferAt: new Date(
      row.createdAt + event.tokenUsage.promptCacheTtlMs,
    ).toISOString(),
  };
}
