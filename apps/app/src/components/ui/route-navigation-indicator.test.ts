import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDelayedBusyIndicator,
  ROUTE_NAVIGATION_INDICATOR_MIN_VISIBLE_MS,
  ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS,
} from "./route-navigation-indicator";

afterEach(() => {
  vi.useRealTimers();
});

function driveIndicator() {
  vi.useFakeTimers();
  let visible = false;
  let cleanup: (() => void) | undefined;
  const indicator = createDelayedBusyIndicator((next) => {
    visible = next;
  });
  return {
    setBusy(busy: boolean) {
      cleanup?.();
      cleanup = indicator.update(busy);
    },
    state: () => (visible ? "visible" : "hidden"),
  };
}

describe("createDelayedBusyIndicator", () => {
  it("stays hidden for navigations that resolve before the reveal delay", () => {
    const indicator = driveIndicator();
    indicator.setBusy(true);

    vi.advanceTimersByTime(ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS - 20);
    expect(indicator.state()).toBe("hidden");

    indicator.setBusy(false);
    vi.advanceTimersByTime(1000);
    expect(indicator.state()).toBe("hidden");
  });

  it("reveals once a navigation outlasts the delay", () => {
    const indicator = driveIndicator();
    indicator.setBusy(true);

    expect(indicator.state()).toBe("hidden");
    vi.advanceTimersByTime(ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS);
    expect(indicator.state()).toBe("visible");
  });

  it("holds the revealed indicator long enough to avoid a flash", () => {
    const indicator = driveIndicator();
    indicator.setBusy(true);

    vi.advanceTimersByTime(ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS);
    expect(indicator.state()).toBe("visible");

    indicator.setBusy(false);
    vi.advanceTimersByTime(ROUTE_NAVIGATION_INDICATOR_MIN_VISIBLE_MS - 20);
    expect(indicator.state()).toBe("visible");

    vi.advanceTimersByTime(40);
    expect(indicator.state()).toBe("hidden");
  });

  it("hides immediately when the minimum visible window already elapsed", () => {
    const indicator = driveIndicator();
    indicator.setBusy(true);

    vi.advanceTimersByTime(ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS);
    vi.advanceTimersByTime(ROUTE_NAVIGATION_INDICATOR_MIN_VISIBLE_MS + 100);
    expect(indicator.state()).toBe("visible");

    indicator.setBusy(false);
    expect(indicator.state()).toBe("hidden");
  });
});
