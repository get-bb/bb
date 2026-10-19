// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSustainedFlag } from "./useSustainedFlag";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("reports a flag only after it has stayed on for the whole delay", () => {
  const { result, rerender } = renderHook(
    ({ flag }) => useSustainedFlag(flag, 1_000),
    { initialProps: { flag: true } },
  );

  act(() => vi.advanceTimersByTime(999));
  expect(result.current).toBe(false);

  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);

  rerender({ flag: false });
  expect(result.current).toBe(false);
});

it("restarts the delay each time the flag turns on again", () => {
  const { result, rerender } = renderHook(
    ({ flag }) => useSustainedFlag(flag, 1_000),
    { initialProps: { flag: true } },
  );
  act(() => vi.advanceTimersByTime(1_000));
  expect(result.current).toBe(true);

  rerender({ flag: false });
  rerender({ flag: true });
  expect(result.current).toBe(false);

  act(() => vi.advanceTimersByTime(600));
  rerender({ flag: false });
  rerender({ flag: true });
  act(() => vi.advanceTimersByTime(600));
  expect(result.current).toBe(false);

  act(() => vi.advanceTimersByTime(400));
  expect(result.current).toBe(true);
});
