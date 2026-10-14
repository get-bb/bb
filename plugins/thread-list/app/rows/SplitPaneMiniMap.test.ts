import type { PluginSidebarSplitPane } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import {
  splitPaneMiniMapRepresentsFocusedPane,
  splitPaneMiniMapSlotGeometry,
} from "./SplitPaneMiniMap.js";

function visibleBounds(slot: PluginSidebarSplitPane) {
  const { x, y, width, height, strokeWidth } =
    splitPaneMiniMapSlotGeometry(slot);
  return {
    x: x - strokeWidth / 2,
    y: y - strokeWidth / 2,
    width: width + strokeWidth,
    height: height + strokeWidth,
  };
}

describe("SplitPaneMiniMap", () => {
  it("keeps filled and outlined slots the same size", () => {
    const outlined: PluginSidebarSplitPane = {
      paneId: "pane-left",
      rect: { x: 0, y: 0, width: 0.5, height: 1 },
      isMe: false,
      isFocused: false,
    };
    const filled: PluginSidebarSplitPane = {
      paneId: "pane-right",
      rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
      isMe: true,
      isFocused: true,
    };

    expect(visibleBounds(outlined)).toEqual({
      x: 1,
      y: 1,
      width: 6,
      height: 12,
    });
    expect(visibleBounds(filled)).toEqual({
      x: 7,
      y: 1,
      width: 6,
      height: 12,
    });
    expect(splitPaneMiniMapRepresentsFocusedPane([outlined, filled])).toBe(
      true,
    );
  });

  it("dims the glyph when the row's pane is not focused", () => {
    expect(
      splitPaneMiniMapRepresentsFocusedPane([
        {
          paneId: "pane-left",
          rect: { x: 0, y: 0, width: 0.5, height: 1 },
          isMe: true,
          isFocused: false,
        },
        {
          paneId: "pane-right",
          rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
          isMe: false,
          isFocused: true,
        },
      ]),
    ).toBe(false);
  });
});
