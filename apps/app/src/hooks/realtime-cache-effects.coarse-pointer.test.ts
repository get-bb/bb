import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import { threadTimelineQueryKey } from "./queries/query-keys";

/**
 * Kept apart from `realtime-cache-effects.test.ts`: the pointer class is read
 * from `matchMedia` once at module init, so the coarse branch needs a fresh
 * module instance with a stubbed window, and `vi.stubGlobal`/`vi.resetModules`
 * move a file out of the shared vitest worker (see vitest.shared.ts). Only
 * this case pays for the module-graph re-import; the main suite stays shared.
 */
describe("createRealtimeCacheEffects on coarse pointers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("widens the thread invalidation debounce on coarse pointers", async () => {
    vi.useFakeTimers();
    // `location` rides along because the re-imported graph reaches the sdk
    // module, which resolves its base URL from the window at init.
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      matchMedia: (query: string) => ({
        matches: query === "(pointer: coarse)",
      }),
    });
    vi.resetModules();
    try {
      const coarseModule = await import("./realtime-cache-effects");
      const queryClient = createAppQueryClient({
        defaultOptions: {
          queries: {
            gcTime: Infinity,
            retry: false,
          },
        },
        showMutationErrorToasts: false,
      });
      const effects = coarseModule.createRealtimeCacheEffects({ queryClient });
      const timelineKey = threadTimelineQueryKey("thr_1");
      queryClient.setQueryData(timelineKey, { rows: [] });

      effects.handleChanged({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        metadata: {
          eventTypes: ["item/agentMessage/delta"],
          projectId: "project-1",
        },
        changes: ["events-appended"],
      });

      // The fine-pointer cadence would have flushed at 50 ms.
      vi.advanceTimersByTime(50);
      expect(queryClient.getQueryState(timelineKey)?.isInvalidated).not.toBe(
        true,
      );
      vi.advanceTimersByTime(100);
      expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);

      effects.dispose();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
