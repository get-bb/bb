// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markRouteContentPainted,
  resetRouteContentPaintForTest,
} from "@/lib/route-content-paint";

const mocks = vi.hoisted(() => ({
  bootPluginFrontends: vi.fn(async () => {}),
  systemConfigData: undefined as unknown,
}));

vi.mock("@/lib/plugin-frontend-lazy", () => ({
  bootPluginFrontends: mocks.bootPluginFrontends,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: mocks.systemConfigData }),
}));

import { usePluginFrontendBoot } from "./usePluginFrontendBoot";

const flushMicrotasks = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.systemConfigData = { generalSettings: {} };
  resetRouteContentPaintForTest();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.bootPluginFrontends.mockClear();
});

describe("usePluginFrontendBoot", () => {
  it("does not boot on system config alone; boots after route paint plus idle", async () => {
    renderHook(() => usePluginFrontendBoot());
    await flushMicrotasks();
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();

    await act(async () => {
      markRouteContentPainted();
    });
    // Idle in jsdom = two animation frames (no requestIdleCallback).
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
    mocks.systemConfigData = undefined;
    renderHook(() => usePluginFrontendBoot());
    await act(async () => {
      markRouteContentPainted();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.bootPluginFrontends).not.toHaveBeenCalled();
  });
});
