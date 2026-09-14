// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("cancels its pending update when unmounted", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 120),
      { initialProps: { value: "main" } },
    );

    rerender({ value: "feature/one" });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes only the latest value after the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 120),
      { initialProps: { value: "main" } },
    );

    rerender({ value: "feature/one" });
    rerender({ value: "feature/two" });
    act(() => vi.advanceTimersByTime(119));
    expect(result.current).toBe("main");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("feature/two");
  });
});
