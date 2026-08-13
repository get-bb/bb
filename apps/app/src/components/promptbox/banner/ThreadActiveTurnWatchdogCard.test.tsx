// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadActiveTurnWatchdogCard } from "./ThreadActiveTurnWatchdogCard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ThreadActiveTurnWatchdogCard", () => {
  it("stays hidden until the quiet threshold, then offers a user-controlled stop", () => {
    vi.useFakeTimers();
    vi.setSystemTime(200_000);
    const onStop = vi.fn();
    const activity = {
      phase: "provider" as const,
      detail: null,
      startedAt: 1_000,
      updatedAt: 100_000,
      lastProgressSequence: 3,
      quietThresholdMs: 120_000,
    };
    const view = render(
      <ThreadActiveTurnWatchdogCard
        activity={activity}
        isStopping={false}
        onStop={onStop}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    vi.setSystemTime(221_000);
    view.rerender(
      <ThreadActiveTurnWatchdogCard
        activity={{ ...activity }}
        isStopping={false}
        onStop={onStop}
      />,
    );
    act(() => vi.advanceTimersByTime(15_000));

    expect(screen.getByText("Waiting for provider")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop turn" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
