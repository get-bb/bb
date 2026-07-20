import { describe, expect, it, vi } from "vitest";
import {
  getPluginThreadRowStatus,
  resetPluginThreadRowStatusesForTest,
  setPluginThreadRowStatus,
  subscribePluginThreadRowStatus,
} from "./plugin-thread-row-status";

const RUNNING_STATUS = {
  icon: "AiContentGenerator01",
  label: "Plugin improving draft",
  effect: "shimmer",
  tone: "default",
} as const;

describe("plugin thread-row status", () => {
  it("sets, notifies, and clears a plugin-owned thread status", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePluginThreadRowStatus("thr_1", listener);

    setPluginThreadRowStatus("thr_1", "composer-status-test", RUNNING_STATUS);
    expect(getPluginThreadRowStatus("thr_1")).toEqual(RUNNING_STATUS);
    expect(listener).toHaveBeenCalledTimes(1);

    setPluginThreadRowStatus("thr_1", "composer-status-test", null);
    expect(getPluginThreadRowStatus("thr_1")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    resetPluginThreadRowStatusesForTest();
  });

  it("ignores new-thread scopes without a thread row", () => {
    setPluginThreadRowStatus(null, "composer-status-test", RUNNING_STATUS);
    expect(getPluginThreadRowStatus("thr_1")).toBeNull();
    resetPluginThreadRowStatusesForTest();
  });
});
