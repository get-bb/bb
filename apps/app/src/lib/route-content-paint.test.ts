import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_ROUTE_PAINT_BACKSTOP_MS,
  markRouteContentPainted,
  markRouteContentPaintedForRoute,
  resetRouteContentPaintForTest,
  whenRouteContentPainted,
} from "./route-content-paint";

function trackPainted(): () => boolean {
  let painted = false;
  void whenRouteContentPainted().then(() => {
    painted = true;
  });
  return () => painted;
}

describe("markRouteContentPaintedForRoute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRouteContentPaintForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRouteContentPaintForTest();
  });

  it("marks a non-thread route painted at once", async () => {
    const isPainted = trackPainted();

    markRouteContentPaintedForRoute(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(isPainted()).toBe(true);
  });

  it("marks a thread route painted after the backstop when no timeline finishes", async () => {
    const isPainted = trackPainted();

    markRouteContentPaintedForRoute(true);
    await vi.advanceTimersByTimeAsync(THREAD_ROUTE_PAINT_BACKSTOP_MS - 1);
    expect(isPainted()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(isPainted()).toBe(true);
  });

  it("lets the timeline mark a thread route painted before the backstop", async () => {
    const isPainted = trackPainted();

    markRouteContentPaintedForRoute(true);
    markRouteContentPainted();
    await vi.advanceTimersByTimeAsync(0);

    expect(isPainted()).toBe(true);
  });
});
