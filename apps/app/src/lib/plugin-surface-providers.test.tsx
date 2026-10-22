// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "./plugin-frontend-boot-state";
import {
  expectedSurfaceProviderIds,
  useRememberSurfaceProvider,
  type PluginSurface,
} from "./plugin-surface-providers";

function renderProvider(surface: PluginSurface, pluginId: string | null) {
  return renderHook(
    ({ pluginId }) => useRememberSurfaceProvider(surface, pluginId),
    { initialProps: { pluginId } },
  );
}

afterEach(() => {
  cleanup();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
});

describe("expectedSurfaceProviderIds", () => {
  it("expects bb's own composer, thread list and navigation before anything is remembered", () => {
    expect(expectedSurfaceProviderIds()).toEqual([
      "bb--composer",
      "thread-list",
      "navigation",
    ]);
  });

  it("lists each remembered provider once in place of the default", () => {
    renderProvider("composer", "lists");
    renderProvider("thread-list", "lists");
    renderProvider("sidebar-navigation", "lists");

    expect(expectedSurfaceProviderIds()).toEqual(["lists"]);
  });

  it("keeps the provider while plugins are still loading, and expects none once boot completes without one", () => {
    renderProvider("thread-list", "my-thread-list").unmount();
    markPluginFrontendBootStarted();

    renderProvider("thread-list", null);
    expect(expectedSurfaceProviderIds()).toEqual([
      "bb--composer",
      "my-thread-list",
      "navigation",
    ]);

    act(() => markPluginFrontendsSettled());
    expect(expectedSurfaceProviderIds()).toEqual([
      "bb--composer",
      "navigation",
    ]);
  });
});
