import { describe, expect, it } from "vitest";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { LayoutNode, PaneContent, SplitLayout } from "@/lib/split-layout";
import {
  indicatorSplitLayoutAtom,
  resolvePaneContentSplitIndicator,
} from "./paneContentSplitIndicator";

function content(threadId: string): PaneContent {
  return { kind: "thread", projectId: "p1", threadId };
}

function pane(paneId: string, threadId: string): LayoutNode {
  return { type: "pane", paneId, content: content(threadId) };
}

function twoPanes(focused: string): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [pane("pane-1", "t1"), pane("pane-2", "t2")],
    },
    focusedPaneId: focused,
  };
}

describe("indicatorSplitLayoutAtom", () => {
  it("does not subscribe to the split layout on compact viewports", () => {
    expect(indicatorSplitLayoutAtom(true, false)).toBe(splitLayoutAtom);
    expect(indicatorSplitLayoutAtom(true, true)).not.toBe(splitLayoutAtom);
    expect(indicatorSplitLayoutAtom(false, false)).not.toBe(splitLayoutAtom);
  });
});

describe("resolvePaneContentSplitIndicator", () => {
  it("maps the content's pane and the focused pane onto the minimap", () => {
    const indicator = resolvePaneContentSplitIndicator({
      content: content("t1"),
      enabled: true,
      isCompact: false,
      layout: twoPanes("pane-2"),
    });

    expect(indicator.isOpenInSplit).toBe(true);
    expect(
      indicator.miniMap?.filter((slot) => slot.isMe).map((slot) => slot.paneId),
    ).toEqual(["pane-1"]);
    expect(
      indicator.miniMap
        ?.filter((slot) => slot.isFocused)
        .map((slot) => slot.paneId),
    ).toEqual(["pane-2"]);
  });

  it("shows no indicator for content that is not open in a split", () => {
    expect(
      resolvePaneContentSplitIndicator({
        content: content("t3"),
        enabled: true,
        isCompact: false,
        layout: twoPanes("pane-1"),
      }),
    ).toEqual({ isOpenInSplit: false, miniMap: null });
  });
});
