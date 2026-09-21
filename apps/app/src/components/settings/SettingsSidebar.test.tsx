// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SETTINGS_NAV_SECTIONS } from "./settings-sections";
import { SettingsSidebarContent } from "./SettingsSidebar";

const configurablePlugin = {
  hasConfiguration: true,
  icon: null,
  id: "linear",
  label: "Linear",
};

const pluginWithoutConfiguration = {
  hasConfiguration: false,
  icon: null,
  id: "themes",
  label: "Themes",
};

function RouteState() {
  const location = useLocation();
  return <output data-testid="route-state">{JSON.stringify(location)}</output>;
}

function renderSidebar(
  activePluginId: string | null = null,
  pluginEntries = [configurablePlugin, pluginWithoutConfiguration],
) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <SettingsSidebarContent
          appRoutePath="/"
          isResizing={false}
          mobileHosted
          navigation={{
            activePluginId,
            activeSection: activePluginId === null ? "general" : null,
            pluginEntries,
            sections: SETTINGS_NAV_SECTIONS,
          }}
          onResizeMouseDown={() => {}}
        />
        <RouteState />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SettingsSidebarContent plugin navigation", () => {
  it("keeps all plugins in one section and opens the appropriate page", async () => {
    renderSidebar();
    await screen.findByRole("link", { name: "Browse plugins" });
    expect(
      screen.queryByRole("link", { name: "Installed plugins" }),
    ).toBeNull();
    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("href"),
    ).toBe("/settings/plugins/linear");
    expect(
      screen.getByRole("link", { name: "Themes" }).getAttribute("href"),
    ).toBe("/settings/plugins/themes?view=installed");
    expect(
      screen.getByRole("link", { name: "Browse plugins" }).getAttribute("href"),
    ).toBe("/plugins");
    expect(
      screen.queryByRole("button", { name: /Other installed plugins/ }),
    ).toBeNull();
  });

  it("offers discovery and creation with no installed plugins", async () => {
    renderSidebar(null, []);
    await screen.findByRole("link", { name: "Browse plugins" });
    expect(screen.getByRole("link", { name: "Browse plugins" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New plugin" }));
    expect(screen.getByTestId("route-state").textContent).toContain(
      "initialPrompt",
    );
    expect(screen.getByTestId("route-state").textContent).toContain(
      "focusPrompt",
    );
  });

  it("marks the active plugin settings page", () => {
    renderSidebar("linear");
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
