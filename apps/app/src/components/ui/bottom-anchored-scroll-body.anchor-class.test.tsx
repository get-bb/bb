// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderBody(scrollOverlay?: ReactNode) {
  const view = render(
    <BottomAnchoredScrollBody
      footer={<div>Footer</div>}
      maxWidthClassName="max-w-none"
      scrollAnchorThreadId="thread-a"
      scrollOverlay={scrollOverlay}
    >
      <div data-timeline-row-id="row-a">row-a</div>
    </BottomAnchoredScrollBody>,
  );
  const row = view.container.querySelector('[data-timeline-row-id="row-a"]');
  const contentWrapper = row?.parentElement;
  const sentinel = view.container.querySelector(".scroll-bottom-anchor");
  if (!contentWrapper || !sentinel) {
    throw new Error("Scroll body did not render its wrapper and sentinel");
  }
  return { container: view.container, contentWrapper, sentinel };
}

describe("BottomAnchoredScrollBody scroll-anchor exclusion", () => {
  it("excludes only the content wrapper and keeps the sentinel outside it", () => {
    vi.stubGlobal("CSS", {
      supports: (property: string, value: string) =>
        property === "overflow-anchor" && value === "none",
    });
    const { container, contentWrapper, sentinel } = renderBody();

    expect(contentWrapper.classList).toContain("scroll-bottom-anchor-content");
    expect(
      container.querySelectorAll(".scroll-bottom-anchor-content"),
    ).toHaveLength(1);
    expect(contentWrapper.contains(sentinel)).toBe(false);
    expect(sentinel.parentElement).toBe(contentWrapper.parentElement);
    const footer = container.querySelector("[data-scroll-footer]");
    expect(footer?.className).toContain("[overflow-anchor:none]");
    expect(footer?.previousElementSibling).toBe(sentinel);
  });

  it("never applies the exclusion class where scroll anchoring is unsupported", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const { container } = renderBody();

    expect(container.querySelector(".scroll-bottom-anchor-content")).toBeNull();
    expect(container.querySelector(".scroll-bottom-anchor")).not.toBeNull();
  });
});

describe("BottomAnchoredScrollBody grid", () => {
  it("keeps the mobile composer outside the conversation scroller as its queue resizes", () => {
    const body = (expanded: boolean) => (
      <CompactViewportOverrideProvider isCompactViewport={true}>
        <BottomAnchoredScrollBody
          footer={
            <div>
              {expanded ? <div>Queued message</div> : null}
              <textarea aria-label="Follow-up" />
            </div>
          }
          maxWidthClassName="max-w-none"
        >
          <div data-timeline-row-id="row-a">Conversation</div>
        </BottomAnchoredScrollBody>
      </CompactViewportOverrideProvider>
    );
    const view = render(body(true));
    const composer = view.getByRole("textbox", { name: "Follow-up" });
    const scrollPort = view.container.querySelector(
      "[data-page-scroll-viewport]",
    );
    const footer = view.container.querySelector("[data-scroll-footer]");
    expect(scrollPort?.contains(composer)).toBe(false);
    expect(footer?.parentElement).toBe(scrollPort?.parentElement);

    view.rerender(body(false));
    expect(view.getByRole("textbox", { name: "Follow-up" })).toBe(composer);
    expect(view.queryByText("Queued message")).toBeNull();
    expect(scrollPort?.contains(composer)).toBe(false);
  });

  it("stacks the scroll port and overlay in one explicit minmax(auto,1fr) row", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const { container } = renderBody(<nav>Overlay</nav>);
    const scrollPort = container.querySelector(".thread-scrollbar");
    const overlay = container.querySelector("[data-scroll-overlay]");
    const grid = scrollPort?.parentElement;

    expect(overlay?.parentElement).toBe(grid);
    expect(grid?.classList).toContain("grid");
    expect(
      [...(grid?.classList ?? [])].filter((token) =>
        token.startsWith("grid-rows-"),
      ),
    ).toEqual(["grid-rows-[minmax(auto,1fr)]"]);
    for (const item of [scrollPort, overlay]) {
      expect([...(item?.classList ?? [])]).toEqual(
        expect.arrayContaining(["row-start-1", "col-start-1", "min-h-0"]),
      );
    }
  });
});
