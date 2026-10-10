import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  INITIAL_MOBILE_RECENTS_REVEAL_STATE,
  stepMobileRecentsReveal,
  type MobileRecentsRevealState,
} from "./useMobileRecentsThreadReveal";

function thread(id: string, overrides: Partial<ThreadListEntry> = {}) {
  return makeThreadListEntry({
    id,
    projectId: "proj_personal",
    lastReadAt: 1,
    latestAttentionAt: 1,
    ...overrides,
  });
}

function unread(entry: ThreadListEntry): ThreadListEntry {
  return { ...entry, status: "idle", latestAttentionAt: 2 };
}

const other = thread("other");
const root = thread("root");
const parent = thread("parent", { parentThreadId: "root" });
const child = thread("child", { parentThreadId: "parent" });

interface Step {
  isPlaceholderData?: boolean;
  selectedThreadId: string;
  threads: readonly ThreadListEntry[] | null;
}

function runSteps(steps: readonly Step[]): string[][] {
  let state: MobileRecentsRevealState = INITIAL_MOBILE_RECENTS_REVEAL_STATE;
  return steps.map(
    ({ isPlaceholderData = false, selectedThreadId, threads }) => {
      const result = stepMobileRecentsReveal(state, {
        isPlaceholderData,
        selectedThreadId,
        threads,
      });
      state = result.state;
      return [...result.ancestorIds];
    },
  );
}

describe("stepMobileRecentsReveal", () => {
  it("opens every ancestor of the thread you navigate to, once per visit", () => {
    const threads = [other, root, parent, child];

    expect(
      runSteps([
        { selectedThreadId: "other", threads },
        { selectedThreadId: "child", threads },
        { selectedThreadId: "child", threads },
        { selectedThreadId: "other", threads },
        { selectedThreadId: "child", threads },
      ]),
    ).toEqual([[], ["parent", "root"], [], [], ["parent", "root"]]);
  });

  it("opens ancestors of newly unread threads but not of threads unread at load or hidden", () => {
    const hiddenChild = thread("hidden", {
      parentThreadId: "root",
      visibility: "hidden",
    });
    const sibling = thread("sibling", { parentThreadId: "parent" });

    expect(
      runSteps([
        {
          selectedThreadId: "other",
          threads: [other, root, parent, unread(child), hiddenChild],
        },
        {
          selectedThreadId: "other",
          threads: [other, root, parent, unread(child), unread(hiddenChild)],
        },
        {
          selectedThreadId: "other",
          threads: [other, root, parent, unread(child), unread(sibling)],
        },
      ]),
    ).toEqual([[], [], ["parent", "root"]]);
  });

  it("waits for the full bootstrap before revealing navigation", () => {
    const threads = [other, root, parent, child];

    expect(
      runSteps([
        { isPlaceholderData: true, selectedThreadId: "other", threads },
        { isPlaceholderData: true, selectedThreadId: "child", threads },
        { selectedThreadId: "child", threads },
      ]),
    ).toEqual([[], [], ["parent", "root"]]);
  });

  it("takes the unread baseline from the full bootstrap, not placeholder data", () => {
    expect(
      runSteps([
        {
          isPlaceholderData: true,
          selectedThreadId: "other",
          threads: [other, root, parent, child],
        },
        {
          selectedThreadId: "other",
          threads: [other, root, parent, unread(child)],
        },
      ]),
    ).toEqual([[], []]);
  });
});
