// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PluginInstallJob } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginInstallJobsQueryKey } from "@/hooks/queries/query-keys";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useOnboardingPluginSwitches,
  type PluginSwitchApply,
} from "./useOnboardingPluginSwitches";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function job(state: PluginInstallJob["state"]): PluginInstallJob {
  const fields = {
    id: "job_1",
    target: {
      kind: "catalog" as const,
      entryId: "workflows",
      marketplace: "bb",
    },
    displayName: "workflows",
  };
  switch (state) {
    case "succeeded":
      return {
        ...fields,
        state,
        plugin: makeInstalledPlugin({ id: "workflows" }),
      };
    case "failed":
      return { ...fields, state, error: "npm exited 1" };
    default:
      return { ...fields, state };
  }
}

function renderSwitches() {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  const view = renderHook(() => useOnboardingPluginSwitches(), { wrapper });
  const onFailed = vi.fn();
  const flip = (enabled: boolean, apply: PluginSwitchApply) =>
    act(() =>
      view.result.current.set({
        pluginId: "workflows",
        enabled,
        serverEnabled: false,
        apply,
        onFailed,
      }),
    );
  const shown = () => view.result.current.shown("workflows", false);
  const flush = () => act(async () => {});
  return { queryClient, flip, shown, flush, onFailed };
}

describe("useOnboardingPluginSwitches", () => {
  it("flips at once and settles on the last value clicked while a change is in flight", async () => {
    const { flip, shown, flush } = renderSwitches();
    const first = createDeferredPromise<string | null>();
    const apply = vi.fn<PluginSwitchApply>(() => first.promise);

    await flip(true, apply);
    expect(shown()).toBe(true);
    await flip(false, apply);
    await flip(true, apply);
    await flip(false, apply);
    expect(shown()).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);

    apply.mockResolvedValue(null);
    first.resolve(null);
    await flush();

    expect(apply.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
    expect(shown()).toBe(false);
  });

  it("flips back and reports the error when a change fails", async () => {
    const { flip, shown, flush, onFailed } = renderSwitches();
    const refused = new Error("offline");

    await flip(true, () => Promise.reject(refused));
    await flush();

    expect(shown()).toBe(false);
    expect(onFailed).toHaveBeenCalledExactlyOnceWith(refused);
  });

  it("waits for an install to finish before applying the next click, and flips back when it fails", async () => {
    const { queryClient, flip, shown, flush, onFailed } = renderSwitches();
    queryClient.setQueryData(pluginInstallJobsQueryKey(), [job("running")]);
    const apply = vi.fn<PluginSwitchApply>(async (enabled) =>
      enabled ? "job_1" : null,
    );

    await flip(true, apply);
    await flip(false, apply);
    await flip(true, apply);
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(true);

    await act(async () => {
      queryClient.setQueryData(pluginInstallJobsQueryKey(), [job("failed")]);
    });
    await flush();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(false);
    expect(onFailed).not.toHaveBeenCalled();
  });
});
