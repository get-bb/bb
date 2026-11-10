// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_WAIT_FAILURE_MS, useReadyHost } from "./useReadyHost";

interface Props {
  hostsLoaded: boolean;
  primaryHost: Host | null;
}

const disconnected = makeHost({ id: "host_1", status: "disconnected" });
const connected = makeHost({ id: "host_1", status: "connected" });

function renderReadyHost(initialProps: Props) {
  return renderHook((props: Props) => useReadyHost(props), { initialProps });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useReadyHost", () => {
  it("holds a computer back until it connects, then keeps it through a reconnect", () => {
    const view = renderReadyHost({
      hostsLoaded: true,
      primaryHost: disconnected,
    });
    expect(view.result.current.readyHost).toBeNull();

    view.rerender({ hostsLoaded: true, primaryHost: connected });
    expect(view.result.current.readyHost?.id).toBe("host_1");

    view.rerender({ hostsLoaded: true, primaryHost: disconnected });
    expect(view.result.current.readyHost?.id).toBe("host_1");
    expect(view.result.current.hostWaitFailure).toBeNull();
  });

  it.each([
    ["no computer has registered", null, "no_host"],
    ["the computer never connects", disconnected, "host_unavailable"],
  ] as const)(
    "reports a failure only once %s within the wait",
    (_case, primaryHost, failure) => {
      const view = renderReadyHost({ hostsLoaded: true, primaryHost });
      act(() => {
        vi.advanceTimersByTime(HOST_WAIT_FAILURE_MS - 1);
      });
      expect(view.result.current.hostWaitFailure).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.result.current.hostWaitFailure).toBe(failure);

      view.rerender({ hostsLoaded: true, primaryHost: connected });
      expect(view.result.current.hostWaitFailure).toBeNull();
    },
  );

  it("does not start the wait until the computer list has loaded", () => {
    const view = renderReadyHost({ hostsLoaded: false, primaryHost: null });
    act(() => {
      vi.advanceTimersByTime(HOST_WAIT_FAILURE_MS);
    });
    expect(view.result.current.hostWaitFailure).toBeNull();
  });
});
