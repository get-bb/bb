// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";

afterEach(cleanup);

describe("BottomAnchoredScrollBody grid", () => {
  it("stacks the scroll port and overlay in one explicit minmax(auto,1fr) row", () => {
    const { container } = render(
      <BottomAnchoredScrollBody
        footer={<div>Footer</div>}
        maxWidthClassName="max-w-none"
        scrollOverlay={<nav>Overlay</nav>}
      >
        <div data-timeline-row-id="row-a">row-a</div>
      </BottomAnchoredScrollBody>,
    );
    const grid = container.firstElementChild;
    const viewport = container.querySelector("[data-page-scroll-viewport]");
    const overlay = screen.getByRole("navigation").parentElement;

    expect(grid?.classList.contains("grid")).toBe(true);
    expect(
      [...(grid?.classList ?? [])].filter((token) =>
        token.startsWith("grid-rows-"),
      ),
    ).toEqual(["grid-rows-[minmax(auto,1fr)]"]);
    for (const item of [viewport, overlay]) {
      expect(item?.parentElement).toBe(grid);
      for (const token of ["row-start-1", "col-start-1", "min-h-0"]) {
        expect(item?.classList.contains(token), token).toBe(true);
      }
    }
    expect(overlay?.hasAttribute("data-scroll-overlay")).toBe(true);
    expect(viewport?.classList.contains("thread-scrollbar")).toBe(true);
  });
});
