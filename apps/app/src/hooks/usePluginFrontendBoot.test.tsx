// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemConfigResponse } from "@bb/server-contract";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import {
  markRouteContentPainted,
  resetRouteContentPaintForTest,
} from "@/lib/route-content-paint";
import * as pluginFrontendLazy from "@/lib/plugin-frontend-lazy";
import * as systemQueries from "@/hooks/queries/system-queries";

import {
  PLUGIN_FRONTEND_SETTLE_FLOOR_MS,
  usePluginFrontendBoot,
} from "./usePluginFrontendBoot";

const mocks = {
  bootPluginFrontends: vi.spyOn(pluginFrontendLazy, "bootPluginFrontends"),
  useSystemConfig: vi.spyOn(systemQueries, "useSystemConfig"),
};
let systemConfigData: SystemConfigResponse | undefined;

function queryResult(
  data: SystemConfigResponse | undefined,
): UseQueryResult<SystemConfigResponse, Error> {
  const common = {
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: "idle" as const,
    isEnabled: true,
    isError: false,
    isFetching: false,
    isLoadingError: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isPaused: false,
    isStale: false,
    refetch: async () => queryResult(data),
  } as const;
  if (data === undefined) {
    return {
      ...common,
      data: undefined,
      isFetched: false,
      isFetchedAfterMount: false,
      isInitialLoading: true,
      isLoading: true,
      isPending: true,
      isSuccess: false,
      promise: new Promise<SystemConfigResponse>(() => {}),
      status: "pending" as const,
    };
  }
  return {
    ...common,
    data,
    isFetched: true,
    isFetchedAfterMount: true,
    isInitialLoading: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    promise: Promise.resolve(data),
    status: "success" as const,
  };
}

const flushMicrotasks = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  systemConfigData = makeSystemConfig();
  mocks.useSystemConfig.mockImplementation(() => queryResult(systemConfigData));
  resetRouteContentPaintForTest();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.bootPluginFrontends.mockClear();
  mocks.useSystemConfig.mockClear();
  resetPluginFrontendBootStateForTest();
});

describe("usePluginFrontendBoot", () => {
  it("does not boot on system config alone; boots after route paint plus idle", async () => {
    renderHook(() => usePluginFrontendBoot());
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();

    await act(async () => {
      markRouteContentPainted();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
  });

  it("boots at the 1.5 s timeout when the route never paints", async () => {
    renderHook(() => usePluginFrontendBoot());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
  });

  it("boots immediately on a plugin panel route: the plugin is the page", async () => {
    window.history.replaceState(null, "", "/plugins/tasks/board");
    renderHook(() => usePluginFrontendBoot());
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
  });

  it("does nothing until system config resolves", async () => {
    systemConfigData = undefined;
    renderHook(() => usePluginFrontendBoot());
    await act(async () => {
      markRouteContentPainted();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
  });

  it("settles after the floor even when system config never resolves", () => {
    systemConfigData = undefined;
    const { result } = renderHook(() => {
      usePluginFrontendBoot();
      return usePluginFrontendsSettled();
    });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(PLUGIN_FRONTEND_SETTLE_FLOOR_MS - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("never settles a boot that is still in flight when the floor elapses", async () => {
    let finishBoot: () => void = () => {};
    mocks.bootPluginFrontends.mockImplementation(() => {
      markPluginFrontendBootStarted();
      return new Promise<void>((resolve) => {
        finishBoot = () => {
          markPluginFrontendsSettled();
          resolve();
        };
      });
    });
    window.history.replaceState(null, "", "/plugins/tasks/board");
    const { result } = renderHook(() => {
      usePluginFrontendBoot();
      return usePluginFrontendsSettled();
    });
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLUGIN_FRONTEND_SETTLE_FLOOR_MS * 2);
    });
    expect(result.current).toBe(false);

    await act(async () => {
      finishBoot();
    });
    expect(result.current).toBe(true);
  });
});
