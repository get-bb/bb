// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSecondTick } from "./useSecondTick";

function setDocumentVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useSecondTick", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("pauses the shared ticker while hidden and jumps to now on resume", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useSecondTick());
    const initial = result.current;

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(initial + 1_000);

    // Hidden: the interval stops entirely — no timer wakes a suspended phone
    // to re-render durations nothing can see.
    act(() => {
      setDocumentVisibility("hidden");
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(initial + 1_000);

    // Visible again: one immediate tick jumps durations to current truth
    // instead of waiting out the next second, then the cadence resumes.
    act(() => {
      setDocumentVisibility("visible");
    });
    expect(result.current).toBe(initial + 6_000);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(initial + 7_000);

    unmount();
  });

  it("shares one interval across subscribers and stops with the last one", () => {
    vi.useFakeTimers();
    const first = renderHook(() => useSecondTick());
    const second = renderHook(() => useSecondTick());

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // One shared tick value, not two phase-shifted timers.
    expect(first.result.current).toBe(second.result.current);

    first.unmount();
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
