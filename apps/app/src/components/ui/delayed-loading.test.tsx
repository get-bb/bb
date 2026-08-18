// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import {
  DEFAULT_LOADING_REVEAL_DELAY_MS,
  DelayedLoading,
} from "@bb/shared-ui/delayed-loading";
import { afterEach, describe, expect, it, vi } from "vitest";

function LoadingProbe({ loading }: { loading: boolean }) {
  return loading ? (
    <DelayedLoading>
      <div role="status">Loading</div>
    </DelayedLoading>
  ) : (
    <div>Loaded</div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DelayedLoading", () => {
  it("reveals the fallback only after the loading delay", () => {
    vi.useFakeTimers();
    const view = render(<LoadingProbe loading />);

    expect(view.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(DEFAULT_LOADING_REVEAL_DELAY_MS - 1));
    expect(view.queryByRole("status")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(view.getByRole("status").textContent).toBe("Loading");
  });

  it("cancels the fallback when loading settles quickly", () => {
    vi.useFakeTimers();
    const view = render(<LoadingProbe loading />);

    view.rerender(<LoadingProbe loading={false} />);
    act(() => vi.advanceTimersByTime(DEFAULT_LOADING_REVEAL_DELAY_MS));

    expect(view.queryByRole("status")).toBeNull();
    expect(view.getByText("Loaded")).toBeDefined();
  });
});
