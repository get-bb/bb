import {
  getExperiments,
  getLatestTokenUsageRow,
  listLatestThreadStateEventRowsByThreadIds,
  type DbConnection,
} from "@bb/db";
import { THREAD_PROVIDER_COMMANDS_STATE_KIND, type Thread } from "@bb/domain";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { extractThreadProviderCommands } from "@bb/thread-view";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";
import { parseStoredEvent } from "./thread-data.js";

const COMPACTION_OFFER_MIN_TOKENS = 100_000;
const BUILTIN_COMPACT_COMMAND_NAME = "compact";

interface CompactionOfferDeps {
  db: DbConnection;
  providerRegistry: Pick<ProviderRegistryService, "supportsManualCompaction">;
}

type CompactionThread = Pick<Thread, "id" | "providerId">;

function liveCommandsIncludeCompact(
  db: DbConnection,
  threadId: string,
): boolean {
  const rows = listLatestThreadStateEventRowsByThreadIds(db, {
    threadIds: [threadId],
    kind: THREAD_PROVIDER_COMMANDS_STATE_KIND,
  });
  const commands = extractThreadProviderCommands(
    rows.map((row) => ({
      event: decodeStoredEventRowCached(db, row),
      meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt },
    })),
  );
  return (
    commands?.some(
      (command) => command.name === BUILTIN_COMPACT_COMMAND_NAME,
    ) ?? false
  );
}

export function supportsBuiltinCompact(
  deps: CompactionOfferDeps,
  args: { providerId: string; threadId: string | null },
): boolean {
  return (
    deps.providerRegistry.supportsManualCompaction(args.providerId) ||
    (args.threadId !== null &&
      liveCommandsIncludeCompact(deps.db, args.threadId))
  );
}

export function isCompactionOfferEnabled(
  deps: CompactionOfferDeps,
  thread: CompactionThread,
): boolean {
  return (
    getExperiments(deps.db).compactExpiredCache &&
    supportsBuiltinCompact(deps, {
      providerId: thread.providerId,
      threadId: thread.id,
    })
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
