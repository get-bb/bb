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
import { ToolsHubExperimentProvider } from "@/components/tools/tools-experiment-context";
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
    toolsRoutePath?: string;
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
        <ToolsHubExperimentProvider enabled={false}>
          <SidebarProvider>
            <PluginNavSidebarItems toolsRoutePath={options.toolsRoutePath} />
          </SidebarProvider>
        </ToolsHubExperimentProvider>
      </MemoryRouter>
    </Provider>,
  );
}

const ROW_LABELS = new Set(["Tools", "Docs", "GitHub"]);

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

  it("hides the built-in Tools row like a plugin row", async () => {
    registerPanel("docs", "Docs");

    renderSidebarItems({ toolsRoutePath: "/tools/skills" });

    // Tools leads the list, above the plugin rows.
    expect(panelRowNames()).toEqual(["Tools", "Docs"]);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Tools panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["Docs"]);
    });
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("More (1)");
    expect(
      window.localStorage.getItem("bb.sidebar.hiddenPluginPanels"),
    ).toContain("__builtin__/tools");
  });

  it("keeps Tools on top for users who already reordered their plugin rows", () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems({
      toolsRoutePath: "/tools/skills",
      storedOrder: ["github/main", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["Tools", "GitHub", "Docs"]);
  });

  it("keeps a saved order when plugin frontends register after the first render", async () => {
    // The Tools row makes this list mount before any plugin has registered.
    // The order effect must not save that empty snapshot over the user's rows.
    renderSidebarItems({
      toolsRoutePath: "/tools/skills",
      storedOrder: ["github/main", "__builtin__/tools", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["Tools"]);

    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Tools", "Docs"]);
    });
  });

  it("saves no Tools key while the row is absent", async () => {
    registerPanel("docs", "Docs");

    // Tools is off, so nothing should reserve a slot for a row that never
    // renders here.
    renderSidebarItems({ storedOrder: ["docs/main"] });

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["Docs"]);
    });
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain("__builtin__/tools");
  });
});
