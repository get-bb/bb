// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appQueryClient } from "@/lib/app-query-client";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
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

const mocks = vi.hoisted(() => ({
  bootPluginFrontends: vi.fn(async () => {}),
  releaseSplitPreloads: vi.fn(),
  systemConfigData: undefined as unknown,
}));

vi.mock("@/lib/split-prefetch", () => ({
  holdSplitPreloads: () => mocks.releaseSplitPreloads,
}));

vi.mock("@/lib/plugin-frontend-lazy", () => ({
  bootPluginFrontends: mocks.bootPluginFrontends,
  whenPriorityPluginFrontendsLoaded: () => new Promise(() => {}),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: mocks.systemConfigData }),
}));

import {
  PLUGIN_FRONTEND_SETTLE_FLOOR_MS,
  usePluginFrontendBoot,
} from "./usePluginFrontendBoot";

const flushMicrotasks = () => act(async () => {});

beforeEach(() => {
  appQueryClient.setQueryData(
    pluginListQueryOptions({ enabled: true }).queryKey,
    [],
  );
  vi.useFakeTimers();
  mocks.systemConfigData = { generalSettings: {} };
  resetRouteContentPaintForTest();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  appQueryClient.clear();
  document.head
    .querySelectorAll(
      'link[rel="modulepreload"], link[data-bb-plugin-css-prefetch]',
    )
    .forEach((link) => link.remove());
  vi.useRealTimers();
  mocks.bootPluginFrontends.mockReset();
  mocks.bootPluginFrontends.mockImplementation(async () => {});
  mocks.releaseSplitPreloads.mockClear();
  resetPluginFrontendBootStateForTest();
});

describe("usePluginFrontendBoot", () => {
  it("downloads priority bundles and starts the runtime before route paint", async () => {
    const plugins = ["bb--composer", "thread-list", "navigation", "other"].map(
      (id) =>
        makeInstalledPlugin({
          id,
          enabled: true,
          status: "running",
          app: {
            bundle: {
              jsUrl: `/plugins/${id}.js`,
              cssUrl: `/plugins/${id}.css`,
              jsBytes: 100,
              hash: id,
              sdkMajor: 0,
              sdkVersion: "0.0.0",
              compatible: true,
            },
          },
        }),
    );
    appQueryClient.setQueryData(
      pluginListQueryOptions({ enabled: true }).queryKey,
      plugins,
    );
    renderHook(() => usePluginFrontendBoot());
    await flushMicrotasks();
    expect(
      [...document.head.querySelectorAll('link[rel="modulepreload"]')].map(
        (link) => link.getAttribute("href"),
      ),
    ).toEqual([
      "/plugins/bb--composer.js",
      "/plugins/thread-list.js",
      "/plugins/navigation.js",
    ]);
    expect(
      document.head.querySelectorAll("link[data-bb-plugin-css-prefetch]"),
    ).toHaveLength(3);
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
  });

  it("boots immediately on a plugin panel route: the plugin is the page", async () => {
    window.history.replaceState(null, "", "/plugins/tasks/board");
    renderHook(() => usePluginFrontendBoot());
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
  });

  it("does nothing until system config resolves", async () => {
    mocks.systemConfigData = undefined;
    renderHook(() => usePluginFrontendBoot());
    await act(async () => {
      markRouteContentPainted();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
  });

  it("settles after the floor even when system config never resolves", () => {
    mocks.systemConfigData = undefined;
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

  it("holds split preloads until every plugin frontend has loaded", async () => {
    let finishBoot: () => void = () => {};
    mocks.bootPluginFrontends.mockImplementation(
      () => new Promise<void>((resolve) => (finishBoot = resolve)),
    );
    window.history.replaceState(null, "", "/plugins/tasks/board");
    renderHook(() => usePluginFrontendBoot());
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
    expect(mocks.releaseSplitPreloads).not.toHaveBeenCalled();

    await act(async () => finishBoot());
    expect(mocks.releaseSplitPreloads).toHaveBeenCalled();
  });
});
