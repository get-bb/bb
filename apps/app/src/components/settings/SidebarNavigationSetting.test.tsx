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
  it("defaults to Automatic, which prefers an installed plugin over the bundled Navigation", async () => {
    registerNavigation("navigation", "navigation", "Navigation");
    registerNavigation("navbar", "grid", "Navigation grid");
    const store = createStore();
    render(
      <Provider store={store}>
        <SidebarNavigationSetting />
      </Provider>,
    );

    expect(store.get(sidebarNavigationProviderAtom)).toBe("__automatic__");
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Sidebar navigation" }),
      { button: 0 },
    );
    const options = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent ?? "",
    );
    expect(
      options.find((option) => option.startsWith("Automatic")),
    ).toContain("Chooses Navigation grid (navbar).");
    expect(options).toHaveLength(3);
    expect(options[1]).toContain("Navigation gridFrom the navbar plugin.");
    expect(options[2]).toContain("Navigation (built-in)BB default.");

    fireEvent.click(screen.getByRole("menuitem", { name: /^Navigation \(built-in\)/u }));
    expect(store.get(sidebarNavigationProviderAtom)).toBe(
      "navigation/navigation",
    );
  });
});
