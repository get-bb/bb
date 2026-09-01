// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SettingsSidebarContent } from "./SettingsSidebar";

const configurablePlugin = {
  icon: null,
  id: "linear",
  label: "Linear",
};

const otherPlugins = [
  { icon: null, id: "disabled", label: "Disabled" },
  { icon: null, id: "plain", label: "Plain" },
];

function renderSidebar(activePluginId: string | null = null) {
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
            otherPluginEntries: otherPlugins,
            pluginEntries: [configurablePlugin],
            sections: [],
          }}
          onResizeMouseDown={() => {}}
          showTopReserve={false}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SettingsSidebarContent plugin groups", () => {
  it("keeps configurable plugins visible and collapses other plugins", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "Linear" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Disabled" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Plain" })).toBeNull();

    const disclosure = screen.getByRole("button", {
      name: "Other installed plugins (2)",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Disabled" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plain" })).toBeTruthy();
  });

  it("starts expanded when the active plugin is in the collapsed group", () => {
    renderSidebar("disabled");

    const disclosure = screen.getByRole("button", {
      name: "Other installed plugins (2)",
    });
    const activePlugin = screen.getByRole("link", { name: "Disabled" });

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(activePlugin.getAttribute("aria-current")).toBe("page");
  });
});
