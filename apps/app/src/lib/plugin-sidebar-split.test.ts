import { describe, expect, it } from "vitest";
import { toPluginSidebarSplitLayout } from "./plugin-sidebar-split";
import type { SplitLayout } from "./split-layout";

const twoPanes: SplitLayout = {
  root: {
    type: "split",
    dir: "row",
    sizes: [0.5, 0.5],
    children: [
      {
        type: "pane",
        paneId: "pane_a",
        content: { kind: "thread", projectId: "proj_1", threadId: "thr_a" },
      },
      {
        type: "pane",
        paneId: "pane_b",
        content: { kind: "thread", projectId: "proj_1", threadId: "thr_b" },
      },
    ],
  },
  focusedPaneId: "pane_b",
};

describe("toPluginSidebarSplitLayout", () => {
  it("is null without a layout or with a single pane", () => {
    expect(toPluginSidebarSplitLayout(null)).toBeNull();
    expect(
      toPluginSidebarSplitLayout({
        root:
          twoPanes.root.type === "split"
            ? twoPanes.root.children[0]!
            : twoPanes.root,
        focusedPaneId: "pane_a",
      }),
    ).toBeNull();
  });

  it("lists every pane with its thread, rect, and focus", () => {
    const layout = toPluginSidebarSplitLayout(twoPanes);
    expect(layout?.panes.map((pane) => pane.threadId)).toEqual([
      "thr_a",
      "thr_b",
    ]);
    expect(layout?.panes.map((pane) => pane.isFocused)).toEqual([false, true]);
    const [left, right] = layout!.panes;
    expect(left!.rect.x).toBe(0);
    expect(left!.rect.width).toBeCloseTo(0.5);
    expect(right!.rect.x).toBeCloseTo(0.5);
    expect(left!.rect.height).toBe(1);
  });
});
