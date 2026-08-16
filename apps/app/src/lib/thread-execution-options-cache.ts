import { resolvedThreadExecutionOptionsSchema } from "@bb/domain";
import { createLastKnownCache } from "@/lib/last-known-cache";

/**
 * The last execution options the server resolved for a thread (provider,
 * model, reasoning, permission mode), replayed to paint the composer's
 * controls on the first frame instead of the hook's neutral defaults. The
 * server owns the resolution policy; this only remembers its last answer, and
 * a replay can be stale, so callers must keep treating it as provisional until
 * the live query settles.
 *
 * Keyed by thread id alone, unlike the model catalog's environment/host/
 * provider scoping: thread ids are globally unique ULIDs, and the resolved
 * options already carry the provider and host context that produced them.
 */
const threadExecutionOptionsCache = createLastKnownCache({
  prefix: "bb.thread-execution-options",
  version: "1",
  schema: resolvedThreadExecutionOptionsSchema,
});

export function threadExecutionOptionsCacheKey(threadId: string): string {
  return threadExecutionOptionsCache.key(threadId);
}

export const readCachedThreadExecutionOptions =
  threadExecutionOptionsCache.read;
export const writeCachedThreadExecutionOptions =
  threadExecutionOptionsCache.write;
