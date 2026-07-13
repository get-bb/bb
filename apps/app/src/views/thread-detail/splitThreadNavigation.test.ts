import { describe, expect, it } from "vitest";
import { findPaneByThread, listPanes, splitPane } from "@/lib/split-layout";
import type { SplitLayout } from "@/lib/split-layout";
import {
  createSinglePaneLayout,
  focusedThreadRoute,
  reconcileLayoutForRoute,
} from "./splitThreadNavigation";

function twoPaneLayout(): SplitLayout {
  // pane-2 (thread-2) is focused (splitPane focuses the new pane); pane-1 holds
  // thread-1.
  return splitPane(createSinglePaneLayout({ projectId: "p1", threadId: "thread-1" }), "pane-1", "right", {
    kind: "thread",
    projectId: "p1",
    threadId: "thread-2",
  });
}

describe("reconcileLayoutForRoute", () => {
  it("seeds a single pane from the route when there is no layout (restore fallback)", () => {
    const layout = reconcileLayoutForRoute(null, {
      projectId: "p1",
      threadId: "thread-1",
    });

    expect(listPanes(layout.root)).toHaveLength(1);
    expect(layout.focusedPaneId).toBe("pane-1");
    expect(findPaneByThread(layout.root, "p1", "thread-1")?.paneId).toBe(
      "pane-1",
    );
  });

  it("replaces only the focused pane's content, preserving the rest of the split", () => {
    const before = twoPaneLayout();

    const after = reconcileLayoutForRoute(before, {
      projectId: "p1",
      threadId: "thread-3",
    });

    // Layout shape preserved (still two panes); focused pane now shows thread-3.
    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-2");
    expect(findPaneByThread(after.root, "p1", "thread-3")?.paneId).toBe(
      "pane-2",
    );
    // The other pane is untouched.
    expect(findPaneByThread(after.root, "p1", "thread-1")?.paneId).toBe(
      "pane-1",
    );
    // thread-2 was displaced from the focused pane.
    expect(findPaneByThread(after.root, "p1", "thread-2")).toBeNull();
  });

  it("focuses an existing pane instead of duplicating an already-open thread", () => {
    const before = twoPaneLayout();

    const after = reconcileLayoutForRoute(before, {
      projectId: "p1",
      threadId: "thread-1",
    });

    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-1");
  });

  it("is a no-op when the route already matches the focused pane", () => {
    const before = twoPaneLayout();

    const after = reconcileLayoutForRoute(before, {
      projectId: "p1",
      threadId: "thread-2",
    });

    expect(after).toBe(before);
  });
});

describe("focusedThreadRoute", () => {
  it("reports the focused pane's thread so URL sync targets it", () => {
    const layout = twoPaneLayout();

    expect(focusedThreadRoute(layout)).toEqual({
      projectId: "p1",
      threadId: "thread-2",
    });

    // Reconciling to the other open thread focuses it, and URL sync follows.
    const focusedOther = reconcileLayoutForRoute(layout, {
      projectId: "p1",
      threadId: "thread-1",
    });
    expect(focusedThreadRoute(focusedOther)).toEqual({
      projectId: "p1",
      threadId: "thread-1",
    });
  });
});
