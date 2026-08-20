import { describe, expect, it } from "vitest";
import {
  INITIAL_STICKY_BOTTOM_STATE,
  reduceStickyBottom,
  resolveInitialScrollTarget,
  shouldFollowContentGrowth,
  shouldShowJumpToLatest,
  type ScrollMetrics,
  type StickyBottomState,
} from "./sticky-bottom";

function metrics(
  offsetY: number,
  contentHeight = 2000,
  viewportHeight = 600,
): ScrollMetrics {
  return { offsetY, contentHeight, viewportHeight };
}

function run(
  events: Parameters<typeof reduceStickyBottom>[1][],
  start: StickyBottomState = INITIAL_STICKY_BOTTOM_STATE,
): StickyBottomState {
  return events.reduce(reduceStickyBottom, start);
}

describe("reduceStickyBottom", () => {
  it("stays stuck when content growth moves the viewport off the bottom without user input", () => {
    // Stuck at the bottom, then a row streams in: the scroll event reports a
    // gap before the follow-up scroll lands. No drag → still following.
    const state = run([
      { type: "scroll", metrics: metrics(1400) },
      { type: "scroll", metrics: metrics(1400, 2600) },
    ]);
    expect(state.stuck).toBe(true);
    expect(shouldFollowContentGrowth(state, metrics(1400, 2600))).toBe(true);
  });

  it("does not re-stick on programmatic scroll events after a detach (initial jump to the unread divider)", () => {
    // The list reports its old bottom offset while the jump to index 0 is
    // still landing; that must not re-enable following.
    const state = run([
      { type: "detach" },
      { type: "scroll", metrics: metrics(1400) },
      // iOS reports the end of a programmatic animated scroll as momentum.
      { type: "momentum-end", metrics: metrics(1400) },
      { type: "scroll", metrics: metrics(0) },
    ]);
    expect(state.stuck).toBe(false);
    expect(shouldFollowContentGrowth(state, metrics(0, 3000))).toBe(false);
  });

  it("unsticks only when the user drags away from the bottom", () => {
    const dragging = run([
      { type: "scroll", metrics: metrics(1400) },
      { type: "drag-start" },
      { type: "scroll", metrics: metrics(900) },
    ]);
    expect(dragging).toEqual({ stuck: false, interacting: true });
    // Momentum after the drag keeps the unstuck state.
    const coasting = run(
      [
        { type: "drag-end", metrics: metrics(850), willDecelerate: true },
        { type: "scroll", metrics: metrics(700) },
        { type: "momentum-end", metrics: metrics(650) },
      ],
      dragging,
    );
    expect(coasting).toEqual({ stuck: false, interacting: false });
    expect(shouldFollowContentGrowth(coasting, metrics(650))).toBe(false);
    expect(shouldShowJumpToLatest(coasting, metrics(650))).toBe(true);
  });

  it("re-sticks when the reader scrolls back to the bottom or jumps to latest", () => {
    const away = run([
      { type: "drag-start" },
      { type: "scroll", metrics: metrics(100) },
      { type: "drag-end", metrics: metrics(100), willDecelerate: false },
    ]);
    expect(away.stuck).toBe(false);
    const back = run(
      [
        { type: "drag-start" },
        { type: "scroll", metrics: metrics(1390) },
        { type: "drag-end", metrics: metrics(1390), willDecelerate: false },
      ],
      away,
    );
    expect(back.stuck).toBe(true);
    expect(reduceStickyBottom(away, { type: "jump-to-latest" })).toEqual({
      stuck: true,
      interacting: false,
    });
    expect(shouldShowJumpToLatest(back, metrics(1390))).toBe(false);
  });

  it("does not offer jump-to-latest while just under a viewport away from the end", () => {
    const state = run([
      { type: "drag-start" },
      { type: "scroll", metrics: metrics(1200) },
      { type: "drag-end", metrics: metrics(1200), willDecelerate: false },
    ]);
    expect(state.stuck).toBe(false);
    // 200px from the bottom on a 600px viewport: the end is still near.
    expect(shouldShowJumpToLatest(state, metrics(1200))).toBe(false);
    expect(shouldShowJumpToLatest(state, metrics(900))).toBe(true);
  });

  it("never follows content that does not overflow the viewport", () => {
    expect(
      shouldFollowContentGrowth(INITIAL_STICKY_BOTTOM_STATE, {
        contentHeight: 300,
        viewportHeight: 600,
      }),
    ).toBe(false);
  });
});

describe("resolveInitialScrollTarget", () => {
  it("lands on the unread divider when auto-scroll is requested, else the end", () => {
    expect(
      resolveInitialScrollTarget({
        itemCount: 10,
        unreadDividerAutoScroll: true,
        unreadDividerIndex: 4,
      }),
    ).toEqual({ kind: "index", index: 4 });
    expect(
      resolveInitialScrollTarget({
        itemCount: 10,
        unreadDividerAutoScroll: true,
        unreadDividerIndex: -1,
      }),
    ).toEqual({ kind: "end" });
    expect(
      resolveInitialScrollTarget({
        itemCount: 10,
        unreadDividerAutoScroll: false,
        unreadDividerIndex: 4,
      }),
    ).toEqual({ kind: "end" });
    expect(
      resolveInitialScrollTarget({
        itemCount: 0,
        unreadDividerAutoScroll: true,
        unreadDividerIndex: 0,
      }),
    ).toBeNull();
  });
});
