// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineTurnProcessContext } from "./timeline-turn-process";
import {
  formatMessageAbsoluteTime,
  formatMessageClockTime,
  MessageTimestamp,
} from "./MessageTimestamp";

function renderTimestamp(
  props: Parameters<typeof MessageTimestamp>[0],
  timings?: Parameters<typeof TimelineTurnProcessContext.Provider>[0]["value"],
) {
  return render(
    <TimelineTurnProcessContext.Provider value={timings ?? new Map()}>
      <MessageTimestamp {...props} />
    </TimelineTurnProcessContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MessageTimestamp", () => {
  it("shows the message's local clock time", () => {
    const createdAt = new Date(2026, 2, 5, 14, 32, 10).getTime();

    const { container } = renderTimestamp({ createdAt, turnId: null });

    expect(container.textContent).toBe(formatMessageClockTime(createdAt));
  });

  it("exposes the full timestamp on hover", () => {
    const createdAt = new Date(2026, 2, 5, 14, 32, 10).getTime();

    const { container } = renderTimestamp({ createdAt, turnId: null });

    expect(
      container
        .querySelector("[data-message-timestamp]")
        ?.getAttribute("title"),
    ).toBe(formatMessageAbsoluteTime(createdAt));
  });

  it("appends the owning turn's duration", () => {
    const { container } = renderTimestamp(
      { createdAt: 1_000, turnId: "turn-1" },
      new Map([
        ["turn-1", { completedAt: 84_000, live: false, startedAt: 1_000 }],
      ]),
    );

    expect(container.textContent).toBe(
      `${formatMessageClockTime(1_000)} · 1m 23s`,
    );
  });

  it("hides durations that are too short to read", () => {
    const { container } = renderTimestamp(
      { createdAt: 1_000, turnId: "turn-1" },
      new Map([
        ["turn-1", { completedAt: 1_500, live: false, startedAt: 1_000 }],
      ]),
    );

    expect(container.textContent).toBe(formatMessageClockTime(1_000));
  });

  it("shows only the clock time for messages without a turn", () => {
    const { container } = renderTimestamp({ createdAt: 1_000, turnId: null });

    expect(container.textContent).toBe(formatMessageClockTime(1_000));
  });

  it("counts a live turn up while it runs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { container } = renderTimestamp(
      { createdAt: 1_000, turnId: "turn-1" },
      new Map([
        ["turn-1", { completedAt: null, live: true, startedAt: 7_000 }],
      ]),
    );

    expect(container.textContent).toBe(`${formatMessageClockTime(1_000)} · 3s`);

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(container.textContent).toBe(`${formatMessageClockTime(1_000)} · 7s`);
  });
});
