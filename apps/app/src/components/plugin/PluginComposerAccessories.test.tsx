// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PluginComposerAccessoryRegistration } from "@bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  PLUGIN_COMPOSER_ACCESSORY_USAGE_STORAGE_KEY,
  resetPluginComposerAccessoryUsageForTest,
} from "@/lib/plugin-composer-accessory-usage";
import { PluginComposerAccessories } from "./PluginComposerAccessories";

function registrationSet(
  composerAccessories: readonly PluginComposerAccessoryRegistration[],
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories,
    pendingInteractions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  };
}

function registerPlugin(pluginId: string, labels = [pluginId]): void {
  setPluginSlotRegistrations(
    pluginId,
    registrationSet(
      labels.map((label, index) => ({
        id: `action-${index}`,
        component: function Accessory() {
          return <button type="button">{label}</button>;
        },
      })),
    ),
  );
}

function renderAccessories() {
  return render(
    <MemoryRouter>
      <PluginComposerAccessories />
    </MemoryRouter>,
  );
}

function inlinePluginIds(): string[] {
  return Array.from(
    document.querySelectorAll(
      '[data-plugin-composer-accessory-placement="inline"]',
    ),
  ).flatMap((element) => {
    const pluginId = element.getAttribute(
      "data-plugin-composer-accessory-plugin",
    );
    return pluginId === null ? [] : [pluginId];
  });
}

describe("PluginComposerAccessories overflow", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
    resetPluginComposerAccessoryUsageForTest();
    resetPluginSlotStoreForTest();
  });

  it("shows at most three plugins inline and mounts the rest on demand", () => {
    for (const pluginId of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
      registerPlugin(pluginId);
    }

    renderAccessories();

    expect(inlinePluginIds()).toEqual(["alpha", "beta", "delta"]);
    expect(screen.queryByRole("button", { name: "epsilon" })).toBeNull();
    expect(screen.queryByRole("button", { name: "gamma" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "More plugin actions" }),
    );

    const overflow = document.querySelector(
      "[data-plugin-composer-accessory-overflow]",
    );
    if (!(overflow instanceof HTMLElement)) {
      throw new Error("Expected the plugin overflow to be mounted");
    }
    expect(
      within(overflow).getByRole("button", { name: "epsilon" }),
    ).toBeDefined();
    expect(
      within(overflow).getByRole("button", { name: "gamma" }),
    ).toBeDefined();
  });

  it("counts a plugin with multiple accessory registrations once", () => {
    registerPlugin("alpha", ["alpha one", "alpha two"]);
    registerPlugin("beta");
    registerPlugin("gamma");

    renderAccessories();

    expect(
      screen.queryByRole("button", { name: "More plugin actions" }),
    ).toBeNull();
    expect(inlinePluginIds()).toEqual(["alpha", "beta", "gamma"]);
    expect(screen.getByRole("button", { name: "alpha one" })).toBeDefined();
    expect(screen.getByRole("button", { name: "alpha two" })).toBeDefined();
  });

  it("promotes frequently used plugins and persists their counts", () => {
    for (const pluginId of ["alpha", "beta", "gamma", "delta"]) {
      registerPlugin(pluginId);
    }
    const view = renderAccessories();

    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    fireEvent.click(
      screen.getByRole("button", { name: "More plugin actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "gamma" }));
    expect(inlinePluginIds()).toEqual(["alpha", "beta", "delta"]);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(inlinePluginIds()).toEqual(["alpha", "gamma", "beta"]);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          PLUGIN_COMPOSER_ACCESSORY_USAGE_STORAGE_KEY,
        ) ?? "{}",
      ),
    ).toEqual({ alpha: 2, gamma: 1 });

    view.unmount();
    resetPluginComposerAccessoryUsageForTest();
    renderAccessories();
    expect(inlinePluginIds()).toEqual(["alpha", "gamma", "beta"]);
  });

  it("ignores malformed persisted usage", () => {
    window.localStorage.setItem(
      PLUGIN_COMPOSER_ACCESSORY_USAGE_STORAGE_KEY,
      '{"alpha":"often"}',
    );
    resetPluginComposerAccessoryUsageForTest();
    for (const pluginId of ["alpha", "beta", "gamma", "delta"]) {
      registerPlugin(pluginId);
    }

    expect(() => renderAccessories()).not.toThrow();
    expect(inlinePluginIds()).toEqual(["alpha", "beta", "delta"]);
  });
});
