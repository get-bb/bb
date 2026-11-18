import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  SCREEN_PAINT_DEADLINE_MS,
  resetScreenPaintForTest,
  whenScreenPainted,
} from "./screen-paint";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  resetScreenPaintForTest();
});

afterEach(() => {
  resetScreenPaintForTest();
  vi.useRealTimers();
});

it("releases waiters at the deadline when no screen ever signals that it painted", async () => {
  const released = vi.fn();
  void whenScreenPainted().then(released);

  await vi.advanceTimersByTimeAsync(SCREEN_PAINT_DEADLINE_MS - 1);
  expect(released).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(released).toHaveBeenCalledTimes(1);
});

it("counts the deadline from page start, so a waiter that arrives late is released at once", async () => {
  await vi.advanceTimersByTimeAsync(SCREEN_PAINT_DEADLINE_MS + 500);
  const released = vi.fn();
  void whenScreenPainted().then(released);

  await vi.advanceTimersByTimeAsync(0);
  expect(released).toHaveBeenCalledTimes(1);
});
