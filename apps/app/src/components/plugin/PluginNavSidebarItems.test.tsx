// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ComponentType } from "react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "./PluginSlotMount";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";
import { pluginNavPanelOrderAtom } from "./pluginNavSidebarAtoms";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { findPaneByContent } from "@/lib/split-layout";

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

function registerPanel(
  pluginId: string,
  title: string,
  experimentalSidebarAccessory?: ComponentType,
  experimentalSidebarSubItems?: PluginRegistrationSet["navPanels"][number]["experimental_sidebarSubItems"],
) {
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
          ...(experimentalSidebarAccessory === undefined
            ? {}
            : {
                experimental_sidebarAccessory: experimentalSidebarAccessory,
              }),
          ...(experimentalSidebarSubItems === undefined
            ? {}
            : {
                experimental_sidebarSubItems: experimentalSidebarSubItems,
              }),
        },
      ],
    }),
  );
}

function renderSidebarItems(
  options: {
    toolsRoutePath?: string;
    storedOrder?: string[];
    compactViewport?: boolean;
    initialPath?: string;
    splitEnabled?: boolean;
  } = {},
) {
  const store = createStore();
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  if (options.splitEnabled) {
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-root",
      root: {
        type: "pane",
        paneId: "pane-root",
        content: { kind: "new-thread" },
      },
    });
  }
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <Provider store={store}>
        <MemoryRouter initialEntries={[options.initialPath ?? "/"]}>
          <SidebarProvider>
            <PluginNavSidebarItems
              toolsRoutePath={options.toolsRoutePath}
              splitEnabled={options.splitEnabled}
            />
            <LocationProbe />
          </SidebarProvider>
        </MemoryRouter>
      </Provider>
    </CompactViewportOverrideProvider>,
  );
  return Object.assign(view, { store });
}

function LocationProbe() {
  return <output data-testid="location-path">{useLocation().pathname}</output>;
}

const ROW_LABELS = new Set(["Extensions", "Docs", "GitHub"]);

function panelRowNames(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => ROW_LABELS.has(label));
}

beforeEach(() => {
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("PluginNavSidebarItems", () => {
  it("keeps an accessory-less plugin row unchanged", () => {
    registerPanel("docs", "Docs");

    const view = renderSidebarItems();

    expect(screen.getByRole("button", { name: "Docs" }).textContent).toBe(
      "Docs",
    );
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-7"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-18"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Docs panel options" }),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("expands sidebar sub-items and navigates without changing the parent target", () => {
    function IssueCount() {
      return <span>12</span>;
    }
    registerPanel("lens", "Lens", undefined, [
      {
        id: "issues",
        title: "Issues",
        icon: "Circle",
        subPath: "issues",
        experimental_sidebarAccessory: IssueCount,
      },
      { id: "reviews", title: "Reviews", subPath: "reviews" },
    ]);

    const view = renderSidebarItems();
    const disclosure = screen.getByRole("button", { name: "Expand Lens" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Issues" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reviews" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Issues" }).querySelector(
        '[data-icon="Circle"]',
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Reviews" })
        .querySelector("[data-plugin-nav-sidebar-sub-item-icon-placeholder]"),
    ).toBeTruthy();
    expect(
      view.container.querySelector(
        "[data-plugin-nav-sidebar-sub-item-accessory]",
      )?.textContent,
    ).toBe("12");
    expect(
      window.localStorage.getItem("bb.sidebar.expandedPluginPanels"),
    ).toContain("lens/main");
    expect(
      screen.queryByRole("button", { name: "Issues panel options" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Issues" }));
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/lens/main/issues",
    );

    fireEvent.click(screen.getByRole("button", { name: "Lens" }));
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/lens/main",
    );
  });

  it("reveals the active deep sub-item without matching a shared prefix", () => {
    registerPanel("lens", "Lens", undefined, [
      { id: "issues", title: "Issues", subPath: "issues" },
    ]);

    const active = renderSidebarItems({
      initialPath: "/plugins/lens/main/issues/123",
    });

    expect(
      screen.getByRole("button", { name: "Collapse Lens" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Issues" }).getAttribute(
        "aria-current",
      ),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "Lens" }).getAttribute("aria-current"),
    ).toBeNull();

    active.unmount();
    renderSidebarItems({ initialPath: "/plugins/lens/main/issues-old" });
    expect(
      screen.getByRole("button", { name: "Expand Lens" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issues" })).toBeNull();
  });

  it("opens a sidebar sub-item in a split with its subpath", () => {
    registerPanel("lens", "Lens", undefined, [
      { id: "issues", title: "Issues", subPath: "issues" },
    ]);
    const view = renderSidebarItems({ splitEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Expand Lens" }));

    fireEvent.click(screen.getByRole("button", { name: "Issues" }), {
      metaKey: true,
    });

    const layout = view.store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(
      findPaneByContent(layout!.root, {
        kind: "plugin-panel",
        pluginId: "lens",
        panelPath: "main",
        subPath: "issues",
      }),
    ).not.toBeNull();
  });

  it("does not mount sidebar sub-item accessories on compact viewports", () => {
    let mounts = 0;
    registerPanel("lens", "Lens", undefined, [
      {
        id: "issues",
        title: "Issues",
        subPath: "issues",
        experimental_sidebarAccessory: () => {
          mounts += 1;
          return <span>12</span>;
        },
      },
    ]);
    window.localStorage.setItem(
      "bb.sidebar.expandedPluginPanels",
      JSON.stringify(["lens/main"]),
    );

    const view = renderSidebarItems({ compactViewport: true });

    expect(screen.getByRole("button", { name: "Issues" })).toBeTruthy();
    expect(mounts).toBe(0);
    expect(
      view.container.querySelector(
        "[data-plugin-nav-sidebar-sub-item-accessory]",
      ),
    ).toBeNull();
  });

  it("isolates a crashed sidebar sub-item accessory and retries after reload", () => {
    function CrashingAccessory(): never {
      throw new Error("sub-item accessory crashed");
    }
    registerPanel("lens", "Lens", undefined, [
      {
        id: "issues",
        title: "Issues",
        subPath: "issues",
        experimental_sidebarAccessory: CrashingAccessory,
      },
    ]);
    const view = renderSidebarItems();
    fireEvent.click(screen.getByRole("button", { name: "Expand Lens" }));

    expect(screen.queryByText("plugin lens crashed")).toBeNull();
    expect(
      view.container.querySelector(
        "[data-plugin-nav-sidebar-sub-item-accessory]",
      ),
    ).not.toBeNull();

    resetCrashedPluginSlots("lens");
    act(() =>
      registerPanel("lens", "Lens", undefined, [
        {
          id: "issues",
          title: "Issues",
          subPath: "issues",
          experimental_sidebarAccessory: () => <span>18</span>,
        },
      ]),
    );

    expect(screen.getByText("18")).toBeTruthy();
  });

  it("keeps the panel options trigger visible on mobile", () => {
    registerPanel("docs", "Docs");

    renderSidebarItems();

    expect(
      screen
        .getByRole("button", { name: "Docs panel options" })
        .closest("[data-sidebar-hover-actions-mobile]")
        ?.getAttribute("data-sidebar-hover-actions-mobile"),
    ).toBe("always");
  });

  it("bounds and truncates a long sidebar accessory", () => {
    registerPanel("tasks", "Tasks", () => (
      <span>123456789012345678901234567890</span>
    ));

    const view = renderSidebarItems();
    const accessory = view.container.querySelector(
      "[data-plugin-nav-sidebar-accessory]",
    );

    expect(accessory?.textContent).toBe("123456789012345678901234567890");
    expect(screen.getByRole("button", { name: "Tasks" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Tasks" }).classList.contains("pr-18"),
    ).toBe(true);
    for (const className of [
      "bb-sidebar-hover-actions-fade",
      "right-1",
      "min-w-5",
      "max-h-5",
      "max-w-16",
      "overflow-hidden",
      "text-xs",
      "text-ellipsis",
      "whitespace-nowrap",
    ]) {
      expect(accessory?.classList.contains(className), className).toBe(true);
    }
  });

  it("replaces a live accessory with row options without remounting it", async () => {
    let mounts = 0;
    let unmounts = 0;
    function LiveAccessory() {
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <span>12</span>;
    }
    registerPanel("tasks", "Tasks", LiveAccessory);

    const view = renderSidebarItems();
    const accessory = view.container.querySelector(
      "[data-plugin-nav-sidebar-accessory]",
    );

    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(
      accessory?.getAttribute("data-sidebar-hover-actions-open"),
    ).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Tasks panel options" }),
      { button: 0 },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    ).not.toBeNull();

    expect(accessory?.getAttribute("data-sidebar-hover-actions-open")).toBe(
      "true",
    );
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it("does not mount sidebar accessories on compact viewports", () => {
    let mounts = 0;
    registerPanel("tasks", "Tasks", () => {
      mounts += 1;
      return <span>12</span>;
    });

    const view = renderSidebarItems({ compactViewport: true });

    expect(mounts).toBe(0);
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("hides a crashed accessory and retries it after a plugin reload", () => {
    function CrashingAccessory(): never {
      throw new Error("accessory crashed");
    }
    registerPanel("tasks", "Tasks", CrashingAccessory);

    const view = renderSidebarItems();

    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).not.toBeNull();

    resetCrashedPluginSlots("tasks");
    act(() => registerPanel("tasks", "Tasks", () => <span>18</span>));

    expect(screen.getByText("18")).toBeDefined();
    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
  });

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

  it("hides the built-in Extensions row like a plugin row", async () => {
    registerPanel("docs", "Docs");

    renderSidebarItems({ toolsRoutePath: "/extensions/skills" });

    expect(panelRowNames()).toEqual(["Extensions", "Docs"]);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Extensions panel options" }),
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

  it("keeps Extensions on top for users who already reordered their plugin rows", () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    renderSidebarItems({
      toolsRoutePath: "/extensions/skills",
      storedOrder: ["github/main", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["Extensions", "GitHub", "Docs"]);
  });

  it("keeps a saved order when plugin frontends register after the first render", async () => {
    renderSidebarItems({
      toolsRoutePath: "/extensions/skills",
      storedOrder: ["github/main", "__builtin__/tools", "docs/main"],
    });

    expect(panelRowNames()).toEqual(["Extensions"]);

    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["GitHub", "Extensions", "Docs"]);
    });
  });

  it("saves no Extensions key while the row is absent", async () => {
    registerPanel("docs", "Docs");

    renderSidebarItems({ storedOrder: ["docs/main"] });

    await waitFor(() => {
      expect(panelRowNames()).toEqual(["Docs"]);
    });
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain("__builtin__/tools");
  });

  it("carries both Extensions glyphs so hover swaps without reflow", () => {
    renderSidebarItems({ toolsRoutePath: "/extensions/plugins" });

    const extensionsRow = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.trim() === "Extensions");
    expect(extensionsRow).toBeTruthy();

    const swap = extensionsRow?.querySelector(".bb-sidebar-row-icon-swap");
    expect(swap).toBeTruthy();
    expect(
      swap?.querySelector('.bb-sidebar-row-icon-rest[data-icon="Toolbox"]'),
    ).toBeTruthy();
    expect(
      swap?.querySelector('.bb-sidebar-row-icon-hover[data-icon="ToolCase"]'),
    ).toBeTruthy();
  });
});
