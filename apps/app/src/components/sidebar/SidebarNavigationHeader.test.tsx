// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSidebarHeaderProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import type { ExperimentalSidebarNavigationSlot } from "@/lib/plugin-slots";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { SidebarNavigationHeader } from "./SidebarNavigationHeader";

function HeaderFixture({ width, controlSize }: ExperimentalSidebarHeaderProps) {
  const [crash, setCrash] = useState(false);
  if (crash) throw new Error("header fixture crash");
  return (
    <div data-testid="header-fixture">
      <output data-testid="header-size">
        {width}/{controlSize}
      </output>
      <button type="button" onClick={() => setCrash(true)}>
        Crash header
      </button>
    </div>
  );
}

function navigationSlot(
  headerComponent?: ExperimentalSidebarNavigationSlot["headerComponent"],
): ExperimentalSidebarNavigationSlot {
  return {
    id: "icons",
    title: "Garden icons",
    placement: "list",
    component: () => null,
    ...(headerComponent ? { headerComponent } : {}),
    pluginId: "garden",
    generation: 1,
  };
}

function BundledHeaderFixture() {
  return <div data-testid="bundled-header-fixture" />;
}

const BUNDLED_RAIL: ExperimentalSidebarNavigationSlot = {
  id: "rail",
  title: "Rail",
  placement: "rail",
  component: () => null,
  headerComponent: BundledHeaderFixture,
  pluginId: "navigation",
  generation: 1,
};

function renderHeader(
  slot: ExperimentalSidebarNavigationSlot,
  fallback: ExperimentalSidebarNavigationSlot | null = null,
) {
  return render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <SidebarProvider>
          <SidebarNavigationHeader
            resolved={{ kind: "plugin", slot, fallback }}
          />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>,
  );
}

const resizeCallbacks: ResizeObserverCallback[] = [];

afterEach(() => {
  resizeCallbacks.length = 0;
  vi.unstubAllGlobals();
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetNotificationStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("SidebarNavigationHeader", () => {
  it("leaves the header to bb when the navigation has no header", () => {
    renderHeader(navigationSlot());

    expect(screen.queryByTestId("sidebar-header-slot")).toBeNull();
  });

  it("mounts the navigation's header with the control size", () => {
    renderHeader(navigationSlot(HeaderFixture));

    expect(screen.getByTestId("header-fixture")).toBeDefined();
    expect(screen.getByTestId("header-size").textContent).toBe("0/28");
  });

  it("renders a new width in the same frame the slot resizes", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    renderHeader(navigationSlot(HeaderFixture));

    for (const callback of resizeCallbacks) {
      callback(
        [{ contentRect: { width: 132 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    }

    expect(screen.getByTestId("header-size").textContent).toBe("132/28");
  });

  it("drops a crashing provider and reports it once", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderHeader(navigationSlot(HeaderFixture));

    fireEvent.click(screen.getByRole("button", { name: "Crash header" }));

    expect(screen.queryByTestId("header-fixture")).toBeNull();
    expect(getNotifications()).toEqual([
      expect.objectContaining({
        title: "Sidebar header plugin crashed",
        description: "Garden icons (garden) stopped working.",
      }),
    ]);
  });

  it("draws the bundled header for the same placement when a provider crashes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderHeader(navigationSlot(HeaderFixture), BUNDLED_RAIL);

    fireEvent.click(screen.getByRole("button", { name: "Crash header" }));

    expect(screen.getByTestId("bundled-header-fixture")).toBeDefined();
    expect(getNotifications()).toEqual([
      expect.objectContaining({
        description:
          "Garden icons (garden) stopped working, so bb drew the Rail header instead.",
      }),
    ]);
  });
});
