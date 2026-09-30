// @vitest-environment jsdom

import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSidebarHeaderProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { SidebarHeaderSlot } from "./SidebarHeaderSlot";
import { sidebarHeaderProviderAtom } from "./sidebarHeaderProvider";

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

function registerHeader() {
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      experimentalSidebarHeaders: [
        { id: "icons", title: "Garden icons", component: HeaderFixture },
      ],
    }),
  );
}

function tree(store: ReturnType<typeof createStore>, hidden: boolean) {
  return (
    <Provider store={store}>
      <MemoryRouter>
        <SidebarProvider>
          <SidebarHeaderSlot hidden={hidden} startInsetClassName="pl-9" />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>
  );
}

function renderSlot({
  preference,
  hidden = false,
}: {
  preference?: string;
  hidden?: boolean;
}) {
  const store = createStore();
  if (preference !== undefined)
    store.set(sidebarHeaderProviderAtom, preference);
  const view = render(tree(store, hidden));
  return {
    ...view,
    setHidden: (next: boolean) => view.rerender(tree(store, next)),
  };
}

const resizeCallbacks: ResizeObserverCallback[] = [];

function resizeSlot(width: number) {
  act(() => {
    for (const callback of resizeCallbacks) {
      callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    }
  });
}

afterEach(() => {
  resizeCallbacks.length = 0;
  vi.unstubAllGlobals();
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  resetNotificationStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("SidebarHeaderSlot", () => {
  it("leaves the header to bb until the user picks a provider", () => {
    registerHeader();
    renderSlot({});

    expect(screen.queryByTestId("header-fixture")).toBeNull();
    expect(screen.queryByTestId("sidebar-header-slot")).toBeNull();
  });

  it("mounts the picked provider after bb's toggle with the control size", () => {
    registerHeader();
    renderSlot({ preference: "garden/icons" });

    expect(screen.getByTestId("header-fixture")).toBeDefined();
    expect(screen.getByTestId("header-size").textContent).toBe("0/28");
    expect(screen.getByTestId("sidebar-header-slot").className).toContain(
      "pl-9",
    );
  });

  it("renders nothing for a picked provider that is not installed", () => {
    renderSlot({ preference: "garden/icons" });

    expect(screen.queryByTestId("sidebar-header-slot")).toBeNull();
  });

  it("keeps the provider mounted but hidden while customizing", () => {
    registerHeader();
    renderSlot({ preference: "garden/icons", hidden: true });

    expect(
      screen.getByTestId("sidebar-header-slot").hasAttribute("hidden"),
    ).toBe(true);
    expect(screen.getByTestId("header-fixture")).toBeDefined();
  });

  it("keeps the last width while hidden so providers do not collapse", () => {
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
    registerHeader();
    const view = renderSlot({ preference: "garden/icons" });

    resizeSlot(180);
    expect(screen.getByTestId("header-size").textContent).toBe("180/28");

    view.setHidden(true);
    resizeSlot(0);
    expect(screen.getByTestId("header-size").textContent).toBe("180/28");

    view.setHidden(false);
    resizeSlot(150);
    expect(screen.getByTestId("header-size").textContent).toBe("150/28");
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
    registerHeader();
    renderSlot({ preference: "garden/icons" });

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
    registerHeader();
    renderSlot({ preference: "garden/icons" });

    fireEvent.click(screen.getByRole("button", { name: "Crash header" }));

    expect(screen.queryByTestId("header-fixture")).toBeNull();
    expect(getNotifications()).toEqual([
      expect.objectContaining({
        title: "Sidebar header plugin crashed",
        description:
          "Garden icons (garden) stopped working, so bb removed it from the sidebar header.",
      }),
    ]);
  });
});
