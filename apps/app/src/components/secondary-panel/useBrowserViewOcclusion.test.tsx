// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_VIEW_PASSTHROUGH_ATTRIBUTE,
  isBrowserViewOccluded,
  useBrowserViewOcclusion,
} from "./useBrowserViewOcclusion";

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
}

let host: HTMLDivElement;
let hitStack: Element[];

beforeEach(() => {
  host = document.createElement("div");
  host.getBoundingClientRect = () => rect(300, 200);
  document.body.appendChild(host);
  hitStack = [host];
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => hitStack),
  });
});

afterEach(() => {
  cleanup();
  host.remove();
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
});

describe("isBrowserViewOccluded", () => {
  it("is clear when the browser surface is the topmost hit target", () => {
    expect(isBrowserViewOccluded({ element: host })).toBe(false);
  });

  it("is clear when only descendants or ancestors are hit", () => {
    const child = document.createElement("img");
    host.appendChild(child);
    hitStack = [child, host];
    expect(isBrowserViewOccluded({ element: host })).toBe(false);
    hitStack = [document.body];
    expect(isBrowserViewOccluded({ element: host })).toBe(false);
  });

  it("is occluded when an unrelated element sits above the surface", () => {
    const popover = document.createElement("div");
    document.body.appendChild(popover);
    hitStack = [popover, host];
    expect(isBrowserViewOccluded({ element: host })).toBe(true);
  });

  it("looks through passthrough overlays", () => {
    const guard = document.createElement("div");
    guard.setAttribute(BROWSER_VIEW_PASSTHROUGH_ATTRIBUTE, "");
    document.body.appendChild(guard);
    hitStack = [guard, host];
    expect(isBrowserViewOccluded({ element: host })).toBe(false);
    const menu = document.createElement("div");
    hitStack = [guard, menu, host];
    expect(isBrowserViewOccluded({ element: host })).toBe(true);
  });

  it("is clear for a collapsed surface", () => {
    host.getBoundingClientRect = () => rect(0, 0);
    hitStack = [document.createElement("div"), host];
    expect(isBrowserViewOccluded({ element: host })).toBe(false);
  });
});

describe("useBrowserViewOcclusion", () => {
  it("tracks overlays mounting and unmounting over the surface", async () => {
    const elementRef = { current: host };
    const { result } = renderHook(() =>
      useBrowserViewOcclusion({ elementRef, enabled: true }),
    );
    expect(result.current).toBe(false);

    const popover = document.createElement("div");
    hitStack = [popover, host];
    act(() => {
      document.body.appendChild(popover);
    });
    await waitFor(() => expect(result.current).toBe(true));

    hitStack = [host];
    act(() => {
      popover.remove();
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("reports clear when disabled even if something covers the surface", async () => {
    const elementRef = { current: host };
    const popover = document.createElement("div");
    document.body.appendChild(popover);
    hitStack = [popover, host];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useBrowserViewOcclusion({ elementRef, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
