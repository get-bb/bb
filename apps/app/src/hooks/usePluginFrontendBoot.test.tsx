// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  preloadFirstScreenPluginBundles: vi.fn(async () => {}),
  bootFirstScreenPluginFrontends: vi.fn(async () => {}),
  bootPluginFrontends: vi.fn(async () => {}),
  systemConfigData: undefined as unknown,
}));

vi.mock("@/lib/plugin-frontend-lazy", () => ({
  bootFirstScreenPluginFrontends: mocks.bootFirstScreenPluginFrontends,
  bootPluginFrontends: mocks.bootPluginFrontends,
}));

vi.mock("@/lib/plugin-first-screen-preload", () => ({
  preloadFirstScreenPluginBundles: mocks.preloadFirstScreenPluginBundles,
  preloadModule: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: mocks.systemConfigData }),
}));

import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  PLUGIN_FRONTEND_SETTLE_FLOOR_MS,
  usePluginFrontendBoot,
} from "./usePluginFrontendBoot";

let wrapper: ReturnType<typeof createQueryClientTestHarness>["wrapper"];

const flushMicrotasks = () => act(async () => {});

beforeEach(() => {
  wrapper = createQueryClientTestHarness().wrapper;
  vi.useFakeTimers();
  mocks.systemConfigData = { generalSettings: {} };
  resetRouteContentPaintForTest();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.bootPluginFrontends.mockClear();
  mocks.bootFirstScreenPluginFrontends.mockClear();
  mocks.preloadFirstScreenPluginBundles.mockClear();
  resetPluginFrontendBootStateForTest();
});

describe("usePluginFrontendBoot", () => {
  it("does not boot on system config alone; boots after route paint plus idle", async () => {
    renderHook(() => usePluginFrontendBoot(), { wrapper });
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

  it("preloads first-screen bundles at mount and boots them at route paint, before system config", async () => {
    mocks.systemConfigData = undefined;
    renderHook(() => usePluginFrontendBoot(), { wrapper });
    await flushMicrotasks();
    expect(mocks.preloadFirstScreenPluginBundles).toHaveBeenCalledTimes(1);
    expect(mocks.bootFirstScreenPluginFrontends).not.toHaveBeenCalled();

    await act(async () => {
      markRouteContentPainted();
    });
    expect(mocks.bootFirstScreenPluginFrontends).toHaveBeenCalledTimes(1);
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
  });

  it("does not boot before the route paints, however long config has been ready", async () => {
    renderHook(() => usePluginFrontendBoot(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
  });

  it("boots immediately on a plugin panel route: the plugin is the page", async () => {
    window.history.replaceState(null, "", "/plugins/tasks/board");
    renderHook(() => usePluginFrontendBoot(), { wrapper });
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).toHaveBeenCalledTimes(1);
  });

  it("does nothing until system config resolves", async () => {
    mocks.systemConfigData = undefined;
    renderHook(() => usePluginFrontendBoot(), { wrapper });
    await act(async () => {
      markRouteContentPainted();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
  });

  it("settles after the floor even when system config never resolves", () => {
    mocks.systemConfigData = undefined;
    const { result } = renderHook(
      () => {
        usePluginFrontendBoot();
        return usePluginFrontendsSettled();
      },
      { wrapper },
    );
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
    const { result } = renderHook(
      () => {
        usePluginFrontendBoot();
        return usePluginFrontendsSettled();
      },
      { wrapper },
    );
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
