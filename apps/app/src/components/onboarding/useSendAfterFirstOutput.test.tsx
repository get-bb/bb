// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSendAfterFirstOutput } from "./useSendAfterFirstOutput";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSendAfterFirstOutput", () => {
  it("waits for the terminal's first output, then sends once after it settles", () => {
    const send = vi.fn();
    const { rerender } = renderHook(
      (props: { hasOutput: boolean }) =>
        useSendAfterFirstOutput({
          enabled: true,
          hasOutput: props.hasOutput,
          settleMs: 500,
          send,
        }),
      { initialProps: { hasOutput: false } },
    );

    vi.advanceTimersByTime(5_000);
    expect(send).not.toHaveBeenCalled();

    rerender({ hasOutput: true });
    vi.advanceTimersByTime(499);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledOnce();

    rerender({ hasOutput: true });
    vi.advanceTimersByTime(5_000);
    expect(send).toHaveBeenCalledOnce();
  });

  it("never sends for providers without a terminal connect flow", () => {
    const send = vi.fn();
    renderHook(() =>
      useSendAfterFirstOutput({
        enabled: false,
        hasOutput: true,
        settleMs: 0,
        send,
      }),
    );

    vi.advanceTimersByTime(5_000);
    expect(send).not.toHaveBeenCalled();
  });
});
