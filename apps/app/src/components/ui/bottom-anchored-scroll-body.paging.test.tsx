// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "./bottom-anchored-scroll-body";

const resizeCallbacks = new Set<() => void>();
let footerHeight = 200;

beforeEach(() => {
  footerHeight = 200;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(
        0,
        0,
        600,
        this.hasAttribute("data-scroll-footer") ? footerHeight : 700,
      );
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      private readonly notify: () => void;

      constructor(callback: ResizeObserverCallback) {
        this.notify = () => callback([], this);
      }

      observe() {
        resizeCallbacks.add(this.notify);
      }

      unobserve() {}

      disconnect() {
        resizeCallbacks.delete(this.notify);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  resizeCallbacks.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("excludes the current sticky footer from the browser's paging viewport", () => {
  const view = render(
    <BottomAnchoredScrollBody
      footer={<textarea />}
      maxWidthClassName="max-w-none"
    >
      <p>Transcript</p>
    </BottomAnchoredScrollBody>,
  );
  const scrollArea = view.container.querySelector<HTMLElement>(
    "[data-page-scroll-viewport]",
  );
  if (!scrollArea) throw new Error("Missing scroll viewport");

  expect(getComputedStyle(scrollArea).scrollPaddingBottom).toBe("200px");

  for (const height of [320, 120]) {
    act(() => {
      footerHeight = height;
      for (const callback of resizeCallbacks) callback();
    });
    expect(getComputedStyle(scrollArea).scrollPaddingBottom).toBe(
      `${height}px`,
    );
  }

  view.rerender(
    <BottomAnchoredScrollBody footer={null} maxWidthClassName="max-w-none">
      <p>Transcript</p>
    </BottomAnchoredScrollBody>,
  );
  expect(scrollArea.style.scrollPaddingBottom).toBe("");

  footerHeight = 80;
  view.rerender(
    <BottomAnchoredScrollBody
      footer={<textarea />}
      maxWidthClassName="max-w-none"
    >
      <p>Transcript</p>
    </BottomAnchoredScrollBody>,
  );
  expect(getComputedStyle(scrollArea).scrollPaddingBottom).toBe("80px");
});
