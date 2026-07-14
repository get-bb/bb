import { describe, expect, it } from "vitest";
import {
  findPaneByContent,
  findPaneByThread,
  listPanes,
  splitPane,
} from "@/lib/split-layout";
import type { SplitLayout } from "@/lib/split-layout";
import {
  applyThreadOpenToLayout,
  createSinglePaneLayout,
  focusedPaneRoute,
  focusedThreadRoute,
  reconcileLayoutForContent,
  reconcileLayoutForRoute,
} from "./splitThreadNavigation";

function twoPaneLayout(): SplitLayout {
  // pane-2 (thread-2) is focused (splitPane focuses the new pane); pane-1 holds
  // thread-1.
  return splitPane(
    createSinglePaneLayout({ projectId: "p1", threadId: "thread-1" }),
    "pane-1",
    "right",
    {
      kind: "thread",
      projectId: "p1",
      threadId: "thread-2",
    },
  );
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

describe("mixed page navigation", () => {
  it("keeps New Thread as a singleton and focuses its existing pane", () => {
    const withCompose = splitPane(twoPaneLayout(), "pane-2", "bottom", {
      kind: "new-thread",
    });

    const after = reconcileLayoutForContent(withCompose, {
      kind: "new-thread",
    });

    expect(listPanes(after.root)).toHaveLength(3);
    expect(after.focusedPaneId).toBe(
      findPaneByContent(after.root, { kind: "new-thread" })?.paneId,
    );
    expect(focusedPaneRoute(after)).toBe("/");
  });

  it("updates a plugin pane's subpath without duplicating the panel", () => {
    const plugin = {
      kind: "plugin-panel",
      pluginId: "notes",
      panelPath: "notes",
      subPath: "inbox.md",
    } as const;
    const before = splitPane(twoPaneLayout(), "pane-1", "bottom", plugin);

    const after = reconcileLayoutForContent(before, {
      ...plugin,
      subPath: "work/today.md",
    });

    expect(listPanes(after.root)).toHaveLength(3);
    expect(findPaneByContent(after.root, plugin)?.content).toEqual({
      ...plugin,
      subPath: "work/today.md",
    });
    expect(focusedPaneRoute(after)).toBe("/plugins/notes/notes/work/today.md");
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

describe("applyThreadOpenToLayout", () => {
  it("splits from the focused pane and focuses the opened thread", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p2", threadId: "thread-3" },
      "down",
    );

    expect(listPanes(after.root)).toHaveLength(3);
    expect(focusedThreadRoute(after)).toEqual({
      projectId: "p2",
      threadId: "thread-3",
    });
  });

  it("focuses an already-open thread instead of duplicating it", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p1", threadId: "thread-1" },
      "right",
    );

    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-1");
  });

  it("coerces an edge split to focused-pane replacement at the pane cap", () => {
    const two = twoPaneLayout();
    const three = splitPane(two, two.focusedPaneId, "right", {
      kind: "thread",
      projectId: "p1",
      threadId: "thread-3",
    });
    const four = splitPane(three, three.focusedPaneId, "right", {
      kind: "thread",
      projectId: "p1",
      threadId: "thread-4",
    });
    const focusedPaneId = four.focusedPaneId;

    const after = applyThreadOpenToLayout(
      four,
      { projectId: "p2", threadId: "thread-5" },
      "left",
    );

    expect(listPanes(after.root)).toHaveLength(4);
    expect(after.focusedPaneId).toBe(focusedPaneId);
    expect(findPaneByThread(after.root, "p2", "thread-5")?.paneId).toBe(
      focusedPaneId,
    );
    expect(findPaneByThread(after.root, "p1", "thread-4")).toBeNull();
  });
});
