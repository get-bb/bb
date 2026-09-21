// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SettingsSidebarContent plugin navigation", () => {
  it("opens details for plugins with and without configuration", async () => {
    renderSidebar();
    await screen.findByRole("link", { name: "Linear" });
    expect(
      screen.queryByRole("link", { name: "Installed plugins" }),
    ).toBeNull();
    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("href"),
    ).toBe("/settings/plugins/linear?view=installed");
    expect(
      screen.getByRole("link", { name: "Themes" }).getAttribute("href"),
    ).toBe("/settings/plugins/themes?view=installed");
    expect(screen.queryByRole("link", { name: "Browse plugins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New plugin" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Other installed plugins/ }),
    ).toBeNull();
  });

  it("marks the active plugin settings page", async () => {
    renderSidebar("linear");
    await screen.findByRole("link", { name: "Linear" });
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
