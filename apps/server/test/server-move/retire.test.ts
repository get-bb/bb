import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { retireServerProcess } from "../../src/services/server-move/retire.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("retiring a moved server", () => {
  it("exits once shutdown finishes", async () => {
    const exit = vi.fn();
    const shutdown = createDeferredPromise<void>();

    retireServerProcess({
      exit,
      forceExitAfterMs: 10_000,
      shutdown: () => shutdown.promise,
    });
    expect(exit).not.toHaveBeenCalled();
    shutdown.resolve();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits even when shutdown fails", async () => {
    const exit = vi.fn();

    retireServerProcess({
      exit,
      forceExitAfterMs: 10_000,
      shutdown: async () => {
        throw new Error("close failed");
      },
    });

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("forces an exit when shutdown hangs", () => {
    vi.useFakeTimers();
    const exit = vi.fn();

    retireServerProcess({
      exit,
      forceExitAfterMs: 10_000,
      shutdown: () => createDeferredPromise<void>().promise,
    });

    vi.advanceTimersByTime(9_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
