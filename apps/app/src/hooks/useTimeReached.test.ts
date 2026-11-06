// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimeReached } from "./useTimeReached";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTimeReached", () => {
  it("flips to true once the time passes without any other re-render", () => {
    const { result } = renderHook(() => useTimeReached(NOW + 6 * HOUR_MS));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(6 * HOUR_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(true);
  });

  it("re-arms when the target moves later and stays false for no target", () => {
    const initialProps: { at: number | null } = { at: NOW - HOUR_MS };
    const { result, rerender } = renderHook(({ at }) => useTimeReached(at), {
      initialProps,
    });
    expect(result.current).toBe(true);

    rerender({ at: NOW + HOUR_MS });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(HOUR_MS + 2_000);
    });
    expect(result.current).toBe(true);

    rerender({ at: null });
    expect(result.current).toBe(false);
  });
});
