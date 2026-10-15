// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTimeHasPassed } from "./useTimeHasPassed";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("uses the current clock when an expiry arrives after mounting", () => {
  const { result, rerender } = renderHook<boolean, { atMs: number | null }>(
    ({ atMs }: { atMs: number | null }) => useTimeHasPassed(atMs),
    { initialProps: { atMs: null } },
  );
  act(() => vi.advanceTimersByTime(600_000));
  rerender({ atMs: 900_000 });
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(300_000));
  expect(result.current).toBe(true);
});

it("recognizes an already expired replacement and cancels the old timer", () => {
  const { result, rerender } = renderHook<boolean, { atMs: number | null }>(
    ({ atMs }: { atMs: number | null }) => useTimeHasPassed(atMs),
    { initialProps: { atMs: 900_000 } },
  );
  act(() => vi.advanceTimersByTime(600_000));
  rerender({ atMs: 300_000 });
  act(() => vi.advanceTimersByTime(0));
  expect(result.current).toBe(true);
  rerender({ atMs: null });
  act(() => vi.advanceTimersByTime(900_000));
  expect(result.current).toBe(false);
});
