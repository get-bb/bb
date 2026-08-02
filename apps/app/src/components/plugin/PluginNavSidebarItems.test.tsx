// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";
import { pluginNavPanelOrderAtom } from "./pluginNavSidebarAtoms";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function registerPanel(pluginId: string, title: string) {
  setPluginSlotRegistrations(
    pluginId,
    registrationSet({
      navPanels: [
        {
          id: "main",
          title,
          icon: "Puzzle",
          path: "main",
          component: () => null,
        },
      ],
    }),
  );
}

function renderSidebarItems(
  options: {
    storedOrder?: string[];
  } = {},
) {
  const store = createStore();
  // Seed the store rather than localStorage: the storage atom captured its
  // initial value when this module was imported, before the test could write.
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <SidebarProvider>
          <PluginNavSidebarItems />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>,
  );
}

const ROW_LABELS = new Set(["Docs", "GitHub"]);

function panelRowNames(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => ROW_LABELS.has(label));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("PluginNavSidebarItems", () => {
  it("moves a hidden panel into an expanded More disclosure and back", async () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems();

    expect(panelRowNames()).toEqual(["Docs", "GitHub"]);
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    // The row moves under a collapsed "More (1)" — hiding never expands the
    // disclosure, so the sidebar doesn't grow back to its old height.
    await waitFor(() => {
      expect(
        screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
      ).toContain("More (1)");
    });
    expect(panelRowNames()).toEqual(["GitHub"]);
    expect(
      window.localStorage.getItem("bb.sidebar.hiddenPluginPanels"),
    ).toContain("docs/main");

    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Docs"]);
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Show in sidebar" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
      ).toBeNull();
    });
    // Unhiding restores the panel's original slot rather than appending it.
    expect(panelRowNames()).toEqual(["Docs", "GitHub"]);
  });

  it("collapses hidden panels behind the More toggle on a later mount", async () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");
    window.localStorage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["docs/main"]),
    );

    renderSidebarItems();

    expect(panelRowNames()).toEqual(["GitHub"]);
    const toggle = screen.getByTestId("plugin-nav-sidebar-overflow-toggle");
    expect(toggle.textContent).toContain("More (1)");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Docs"]);
    });
  });

  it("keeps a saved plugin row order", () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems({
      storedOrder: ["github/main", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["GitHub", "Docs"]);
  });

  it("keeps a saved order when plugin frontends register after the first render", async () => {
    renderSidebarItems({
      storedOrder: ["github/main", "docs/main"],
    });

    expect(screen.queryByTestId("plugin-nav-sidebar-items")).toBeNull();

    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Docs"]);
    });
  });
});
