import { describe, expect, it, vi } from "vitest";
import {
  clearPluginThreadRowStatuses,
  clearPluginThreadRowStatusesByOwner,
  getPluginThreadRowStatus,
  resetPluginThreadRowStatusesForTest,
  setPluginThreadRowStatus,
  subscribePluginThreadRowStatus,
} from "./plugin-thread-row-status";

const RUNNING_STATUS = {
  icon: "AiContentGenerator01",
  label: "Plugin improving draft",
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

  it("clears every status owned by a deactivated plugin without touching siblings", () => {
    setPluginThreadRowStatus("thr_1", "prompt-shaper", RUNNING_STATUS);
    setPluginThreadRowStatus("thr_2", "prompt-shaper", RUNNING_STATUS);
    setPluginThreadRowStatus("thr_2", "other-plugin", {
      icon: "Clock",
      label: "Other plugin running",
    });

    clearPluginThreadRowStatuses("prompt-shaper");

    expect(getPluginThreadRowStatus("thr_1")).toBeNull();
    expect(getPluginThreadRowStatus("thr_2")?.label).toBe(
      "Other plugin running",
    );
    resetPluginThreadRowStatusesForTest();
  });

  it("clears one generation owner without touching the same plugin's replacement", () => {
    const oldGeneration = Symbol("old-generation");
    const newGeneration = Symbol("new-generation");
    setPluginThreadRowStatus(
      "thr_1",
      "prompt-shaper",
      RUNNING_STATUS,
      oldGeneration,
    );
    setPluginThreadRowStatus(
      "thr_2",
      "prompt-shaper",
      { icon: "Clock", label: "Replacement running" },
      newGeneration,
    );

    clearPluginThreadRowStatusesByOwner(oldGeneration);

    expect(getPluginThreadRowStatus("thr_1")).toBeNull();
    expect(getPluginThreadRowStatus("thr_2")?.label).toBe(
      "Replacement running",
    );
    resetPluginThreadRowStatusesForTest();
  });
});
