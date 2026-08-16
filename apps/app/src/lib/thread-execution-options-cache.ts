import {
  resolvedThreadExecutionOptionsSchema,
  type ResolvedThreadExecutionOptions,
} from "@bb/domain";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const THREAD_EXECUTION_OPTIONS_CACHE_PREFIX = "bb.thread-execution-options";
const THREAD_EXECUTION_OPTIONS_CACHE_VERSION = "1";

const optionsStorage = createJsonLocalStorage<unknown>();

export function threadExecutionOptionsCacheKey(threadId: string): string {
  return [
    THREAD_EXECUTION_OPTIONS_CACHE_PREFIX,
    THREAD_EXECUTION_OPTIONS_CACHE_VERSION,
    threadId,
  ].join(".");
}

/**
 * The last execution options the server resolved for a thread (provider,
 * model, reasoning, permission mode), used to paint the composer's controls
 * on the first frame instead of the hook's neutral defaults. The server owns
 * the resolution policy; this only remembers its last answer, and a cached
 * answer can be stale, so callers must keep treating it as provisional until
 * the live query settles.
 */
export function readCachedThreadExecutionOptions(
  key: string,
): ResolvedThreadExecutionOptions | null {
  const stored = optionsStorage.getItem(key, null);
  if (stored === null) {
    return null;
  }
  const parsed = resolvedThreadExecutionOptionsSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export function writeCachedThreadExecutionOptions(
  key: string,
  options: ResolvedThreadExecutionOptions,
): void {
  optionsStorage.setItem(key, options);
}
