import { describe, expect, it } from "vitest";
import { formatArchivedEnvironmentThreadsToastTitle } from "./ProjectRow";

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
