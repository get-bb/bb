// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleIdlePreload } from "./idle-preload";

function setSaveData(saveData: boolean | undefined) {
  Object.defineProperty(window.navigator, "connection", {
    configurable: true,
    value: saveData === undefined ? undefined : { saveData },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "connection");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("scheduleIdlePreload", () => {
  it("runs the preload once when the browser is idle", () => {
    const idleCallbacks: IdleRequestCallback[] = [];
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback) => {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const preload = vi.fn();

    scheduleIdlePreload(preload);

    expect(preload).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).toHaveBeenCalledWith(preload, {
      timeout: 3000,
    });
    for (const callback of idleCallbacks) {
      callback({ didTimeout: false, timeRemaining: () => 10 });
    }
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timer and cancels it on cleanup", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const preload = vi.fn();

    const cancel = scheduleIdlePreload(preload);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(preload).not.toHaveBeenCalled();

    scheduleIdlePreload(preload);
    vi.advanceTimersByTime(1500);
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("skips the preload when the user asked to save data", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    setSaveData(true);
    const preload = vi.fn();

    scheduleIdlePreload(preload);
    vi.advanceTimersByTime(5000);

    expect(preload).not.toHaveBeenCalled();
  });
});
