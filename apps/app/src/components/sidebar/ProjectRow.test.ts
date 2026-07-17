import { describe, expect, it } from "vitest";
import {
  formatArchivedEnvironmentThreadsToastTitle,
  shouldSuppressPinnedThreadDropPreview,
} from "./ProjectRow";
import { PINNED_THREAD_PARENT_KEY } from "./useFolderThreadDnd";

describe("formatArchivedEnvironmentThreadsToastTitle", () => {
  it("uses the thread title when archiving one thread", () => {
    expect(
      formatArchivedEnvironmentThreadsToastTitle({
        archivedThreadIds: ["thr_one"],
        threads: [
          {
            id: "thr_one",
            title: "Investigate checkout warnings",
            titleFallback: null,
          },
        ],
      }),
    ).toBe("Archived Investigate checkout warnings");
  });

  it("uses a count when archiving multiple threads", () => {
    expect(
      formatArchivedEnvironmentThreadsToastTitle({
        archivedThreadIds: ["thr_one", "thr_two"],
        threads: [],
      }),
    ).toBe("Archived 2 threads");
  });
});

describe("shouldSuppressPinnedThreadDropPreview", () => {
  it("keeps the preview until the optimistic pinned row exists", () => {
    expect(
      shouldSuppressPinnedThreadDropPreview({
        activeThreadId: "thread-1",
        dragOverParentKey: PINNED_THREAD_PARENT_KEY,
        pinnedThreads: [],
      }),
    ).toBe(false);
  });

  it("suppresses the preview once the optimistic pinned row exists", () => {
    expect(
      shouldSuppressPinnedThreadDropPreview({
        activeThreadId: "thread-1",
        dragOverParentKey: PINNED_THREAD_PARENT_KEY,
        pinnedThreads: [{ id: "thread-1" }],
      }),
    ).toBe(true);
  });
});
