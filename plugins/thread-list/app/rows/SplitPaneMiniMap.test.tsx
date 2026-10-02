// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap.js";

afterEach(cleanup);

function visibleBounds(rect: SVGElement) {
  const strokeWidth = Number(rect.getAttribute("stroke-width"));
  const x = Number(rect.getAttribute("x")) - strokeWidth / 2;
  const y = Number(rect.getAttribute("y")) - strokeWidth / 2;
  return {
    x,
    y,
    width: Number(rect.getAttribute("width")) + strokeWidth,
    height: Number(rect.getAttribute("height")) + strokeWidth,
  };
}

describe("SplitPaneMiniMap", () => {
  it("keeps filled and outlined slots the same size with square corners", () => {
    render(
      <SplitPaneMiniMap
        label="Two-pane split"
        slots={[
          {
            paneId: "pane-left",
            rect: { x: 0, y: 0, width: 0.5, height: 1 },
            isMe: false,
            isFocused: false,
          },
          {
            paneId: "pane-right",
            rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
            isMe: true,
            isFocused: true,
          },
        ]}
      />,
    );

    const miniMap = screen.getByRole("img", { name: "Two-pane split" });
    const [outlined, filled] = miniMap.querySelectorAll("rect");
    if (outlined === undefined || filled === undefined) {
      throw new Error("Expected two mini-map slots");
    }

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
    expect(outlined.hasAttribute("rx")).toBe(false);
    expect(filled.hasAttribute("rx")).toBe(false);
    expect(miniMap.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(miniMap.classList).not.toContain("opacity-60");
  });

  it("dims the glyph when the row's pane is not focused and shimmers while working", () => {
    render(
      <SplitPaneMiniMap
        label="Unfocused split"
        isWorking
        slots={[
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
        ]}
      />,
    );

    const miniMap = screen.getByRole("img", { name: "Unfocused split" });
    expect(miniMap.classList).toContain("opacity-60");
    expect(miniMap.classList).toContain("animate-shine-icon");
  });
});
