// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { sidebarNavigationProviderAtom } from "@/components/sidebar/sidebarNavigationProvider";
import { SidebarNavigationSetting } from "./SidebarNavigationSetting";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

function registerNavigation(pluginId: string, id: string, title: string) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({
      experimentalSidebarNavigations: [{ id, title, component: () => null }],
    }),
  );
}

describe("SidebarNavigationSetting", () => {
  it("defaults to the bundled Navigation plugin and offers no Automatic or built-in choice", async () => {
    registerNavigation("navigation", "navigation", "Navigation");
    registerNavigation("navbar", "grid", "Navigation grid");
    const store = createStore();
    render(
      <Provider store={store}>
        <SidebarNavigationSetting />
      </Provider>,
    );

    expect(store.get(sidebarNavigationProviderAtom)).toBe(
      "navigation/navigation",
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Sidebar navigation" }),
      { button: 0 },
    );
    const options = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent ?? "",
    );
    expect(options.some((option) => option.startsWith("Automatic"))).toBe(
      false,
    );
    expect(options.some((option) => option.includes("built-in"))).toBe(false);

    fireEvent.click(screen.getByRole("menuitem", { name: /Navigation grid/u }));
    expect(store.get(sidebarNavigationProviderAtom)).toBe("navbar/grid");
  });
});
