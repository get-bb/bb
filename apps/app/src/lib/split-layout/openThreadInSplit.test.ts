import { describe, expect, it, vi } from "vitest";
import { openThreadInSplit } from "./openThreadInSplit";
import type { SplitLayout } from "./index";

function layout(threadId = "thread-1"): SplitLayout {
  return {
    root: {
      type: "pane",
      paneId: "pane-1",
      content: { kind: "thread", projectId: "project-1", threadId },
    },
    focusedPaneId: "pane-1",
  };
}

describe("openThreadInSplit", () => {
  it("preserves search deep-link state when creating a split", () => {
    let current = layout();
    const navigate = vi.fn();
    openThreadInSplit({
      store: {
        get: () => current,
        set: (_atom, value) => {
          current = value;
        },
      },
      navigate,
      projectId: "project-1",
      threadId: "thread-2",
      isCompact: false,
      state: { searchMessageSeq: 42, searchThreadId: "thread-2" },
    });

    expect(current.root.type).toBe("split");
    expect(navigate).toHaveBeenCalledWith(
      "/projects/project-1/threads/thread-2",
      {
        state: { searchMessageSeq: 42, searchThreadId: "thread-2" },
      },
    );
  });

  it("keeps replace semantics and state when the result is already open", () => {
    const current = layout("thread-2");
    const navigate = vi.fn();
    openThreadInSplit({
      store: { get: () => current, set: vi.fn() },
      navigate,
      projectId: "project-1",
      threadId: "thread-2",
      isCompact: false,
      state: { searchMessageSeq: 7, searchThreadId: "thread-2" },
    });

    expect(navigate).toHaveBeenCalledWith(
      "/projects/project-1/threads/thread-2",
      {
        replace: true,
        state: { searchMessageSeq: 7, searchThreadId: "thread-2" },
      },
    );
  });
});
