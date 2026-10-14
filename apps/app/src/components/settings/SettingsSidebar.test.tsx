// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { readSettingsSearchAnchor } from "./settings-search";
import { SETTINGS_NAV_SECTIONS } from "./settings-sections";
import {
  SettingsSidebarContent,
  type SettingsSidebarPluginSettingSearch,
} from "./SettingsSidebar";

const configurablePlugin = {
  hasSettingsForm: true,
  icon: null,
  id: "linear",
  label: "Linear",
};

const linearApiKeySetting = {
  description: "Used to read and update issues.",
  key: "apiKey",
  label: "API key",
  pluginId: "linear",
};

interface RenderSidebarOptions {
  activePluginId?: string | null;
  pluginSettingSearch?: Partial<SettingsSidebarPluginSettingSearch>;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div
      data-testid="location"
      data-anchor={readSettingsSearchAnchor(location.state) ?? ""}
    >
      {location.pathname}
    </div>
  );
}

function renderSidebar({
  activePluginId = null,
  pluginSettingSearch,
}: RenderSidebarOptions = {}) {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <LocationProbe />
      <SidebarProvider>
        <SettingsSidebarContent
          isResizing={false}
          navigation={{
            activePluginId,
            activeSection: activePluginId === null ? "general" : null,
            pluginEntries: [configurablePlugin],
            sections: SETTINGS_NAV_SECTIONS,
          }}
          onResizeMouseDown={() => {}}
          pluginSettingSearch={{
            entries: [linearApiKeySetting],
            isLoading: false,
            onActivate: () => {},
            ...pluginSettingSearch,
          }}
          searchConditions={new Set()}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SettingsSidebarContent plugin navigation", () => {
  it("offers installed-plugin management and configurable plugin settings", () => {
    renderSidebar();
    expect(
      screen
        .getByRole("link", { name: "Installed plugins" })
        .getAttribute("href"),
    ).toBe("/settings/plugins");
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("href"),
    ).toBe("/settings/plugins/linear");
    expect(
      screen.queryByRole("button", { name: /Other installed plugins/ }),
    ).toBeNull();
  });

  it("marks the active plugin settings page", () => {
    renderSidebar({ activePluginId: "linear" });
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});

function searchInput(): HTMLElement {
  return screen.getByRole("combobox", { name: "Search settings" });
}

function search(query: string): HTMLElement {
  const input = searchInput();
  fireEvent.change(input, { target: { value: query } });
  return input;
}

function pressKey(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function resultNames(): (string | null)[] {
  return screen.getAllByRole("option").map((option) => option.textContent);
}

describe("SettingsSidebarContent search", () => {
  it("replaces the section list with matching settings while searching", () => {
    renderSidebar();
    search("theme");

    expect(resultNames()).toEqual(["ThemeAppearance", "PaletteAppearance"]);
    expect(screen.queryByRole("link", { name: "General" })).toBeNull();
    expect(
      screen.getAllByRole("option")[0]?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("opens the highlighted setting with Enter and returns to the section list", () => {
    renderSidebar();
    const input = search("theme");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[1]?.id,
    );
    fireEvent.keyDown(input, { key: "Enter" });

    const location = screen.getByTestId("location");
    expect(location.textContent).toBe("/settings/appearance");
    expect(location.dataset.anchor).toBe("Palette");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("link", { name: "General" })).toBeDefined();
  });

  it("wraps from the first result to the last with ArrowUp", () => {
    renderSidebar();
    const input = search("theme");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("location").dataset.anchor).toBe("Palette");
  });

  it("opens a clicked result, including a plugin settings page", () => {
    renderSidebar();
    search("linear");
    fireEvent.click(screen.getByRole("option", { name: /^Linear/ }));

    const location = screen.getByTestId("location");
    expect(location.textContent).toBe("/settings/plugins/linear");
    expect(location.dataset.anchor).toBe("");
  });

  it("opens a setting inside a plugin's page and carries its anchor", () => {
    renderSidebar();
    search("api key");
    expect(resultNames()).toEqual(["API keyLinear"]);
    fireEvent.click(screen.getByRole("option", { name: /API key/ }));

    const location = screen.getByTestId("location");
    expect(location.textContent).toBe("/settings/plugins/linear");
    expect(location.dataset.anchor).toBe("API key");
  });

  it("asks for plugin settings when the field is first focused", () => {
    const onActivate = vi.fn();
    renderSidebar({ pluginSettingSearch: { onActivate } });
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.focus(searchInput());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("holds back the empty message while plugin settings are still loading", () => {
    const { rerender } = renderSidebar({
      pluginSettingSearch: { entries: [], isLoading: true },
    });
    search("api key");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();

    rerender(
      <MemoryRouter initialEntries={["/settings"]}>
        <LocationProbe />
        <SidebarProvider>
          <SettingsSidebarContent
            isResizing={false}
            navigation={{
              activePluginId: null,
              activeSection: "general",
              pluginEntries: [configurablePlugin],
              sections: SETTINGS_NAV_SECTIONS,
            }}
            onResizeMouseDown={() => {}}
            pluginSettingSearch={{
              entries: [],
              isLoading: false,
              onActivate: () => {},
            }}
            searchConditions={new Set()}
          />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status").textContent).toBe("No settings found");
  });

  it("says when nothing matches", () => {
    renderSidebar();
    search("zzzz");

    expect(screen.getByRole("status").textContent).toBe("No settings found");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(searchInput().getAttribute("aria-expanded")).toBe("false");
  });

  it("clears the query with Escape without letting the key leave Settings", () => {
    renderSidebar();
    const input = search("theme");

    expect(pressKey(input, "Escape").defaultPrevented).toBe(true);
    expect(screen.getByRole("link", { name: "General" })).toBeDefined();
    expect(pressKey(input, "Escape").defaultPrevented).toBe(false);
  });

  it("clears the query with the clear button and keeps focus in the field", () => {
    renderSidebar();
    const input = search("theme");
    fireEvent.click(
      screen.getByRole("button", { name: "Clear settings search" }),
    );

    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("focuses the field with / unless the key was typed into another input", () => {
    renderSidebar();
    const other = document.createElement("input");
    document.body.append(other);
    try {
      fireEvent.keyDown(other, { key: "/" });
      expect(document.activeElement).not.toBe(searchInput());

      expect(pressKey(document.body, "/").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(searchInput());
    } finally {
      other.remove();
    }
  });
});
