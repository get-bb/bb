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
import type { PluginNavPanelRegistration } from "@get-bb/plugin-sdk/app";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { appToast } from "@/components/ui/app-toast";
import { writeLastKnownPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "./PluginSlotMount";
import {
  ExtensionsNavSidebarItem,
  PluginNavSidebarItems,
} from "./PluginNavSidebarItems";
import {
  hiddenPluginNavPanelsAtom,
  pluginNavPanelMigratedVisibleLimitAtom,
  pluginNavPanelOrderAtom,
  pluginNavPanelOverflowExpandedAtom,
} from "./pluginNavSidebarAtoms";

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
  experimentalMenu?: PluginNavPanelRegistration["experimental_menu"],
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
          ...(experimentalMenu === undefined
            ? {}
            : { experimental_menu: experimentalMenu }),
        },
      ],
    }),
  );
}

function renderSidebarItems(
  options: {
    storedOrder?: string[];
    compactViewport?: boolean;
    initialEntry?: string;
    overflowExpanded?: boolean;
    hiddenKeys?: string[];
    migratedVisibleLimit?: number | null;
    splitEnabled?: boolean;
    bootComplete?: boolean;
  } = {},
) {
  const store = createStore();
  // Seed the store rather than localStorage: the storage atom captured its
  // initial value when this module was imported, before the test could write.
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
    window.localStorage.setItem(
      "bb.sidebar.pluginPanelOrder",
      JSON.stringify(options.storedOrder),
    );
  }
  if (options.overflowExpanded !== undefined) {
    store.set(pluginNavPanelOverflowExpandedAtom, options.overflowExpanded);
  }
  if (options.hiddenKeys !== undefined) {
    store.set(hiddenPluginNavPanelsAtom, options.hiddenKeys);
    window.localStorage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(options.hiddenKeys),
    );
  }
  if (options.migratedVisibleLimit !== undefined) {
    store.set(
      pluginNavPanelMigratedVisibleLimitAtom,
      options.migratedVisibleLimit,
    );
    if (options.migratedVisibleLimit === null) {
      window.localStorage.removeItem(
        "bb.sidebar.pluginPanelMigratedVisibleLimit",
      );
    } else {
      window.localStorage.setItem(
        "bb.sidebar.pluginPanelMigratedVisibleLimit",
        JSON.stringify(options.migratedVisibleLimit),
      );
    }
  }
  if (options.bootComplete !== false) markPluginFrontendsSettled();
  return render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <Provider store={store}>
        <MemoryRouter initialEntries={[options.initialEntry ?? "/"]}>
          <SidebarProvider>
            <PluginNavSidebarItems splitEnabled={options.splitEnabled} />
            <LocationPath />
          </SidebarProvider>
        </MemoryRouter>
      </Provider>
    </CompactViewportOverrideProvider>,
  );
}

const ROW_LABELS = new Set([
  "Docs",
  "GitHub",
  "Tasks",
  ...Array.from({ length: 9 }, (_, index) => `Plugin ${index + 1}`),
]);

function panelRowNames(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => ROW_LABELS.has(label));
}

beforeEach(() => {
  window.localStorage.clear();
  resetPluginFrontendBootStateForTest();
  resetAllCrashedPluginSlotsForTest();
  // React reports errors caught by the slot boundary; keep expected crashes
  // from obscuring the regression assertions below.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
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
      await screen.findByRole("menuitem", { name: "Plugin settings" }),
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

  it.each([1, 4, 5])("renders %i pages as a flat list", (count) => {
    for (let index = 1; index <= count; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }

    renderSidebarItems();

    expect(panelRowNames()).toEqual(
      Array.from({ length: count }, (_, index) => `Plugin ${index + 1}`),
    );
    expect(screen.queryByTestId("plugin-nav-sidebar-heading")).toBeNull();
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();
  });

  it.each([6, 9])("caps %i pages and labels the overflow", (count) => {
    for (let index = 1; index <= count; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }

    renderSidebarItems();

    expect(panelRowNames()).toEqual([
      "Plugin 1",
      "Plugin 2",
      "Plugin 3",
      "Plugin 4",
      "Plugin 5",
    ]);
    expect(screen.getByTestId("plugin-nav-sidebar-heading").textContent).toBe(
      `Plugin pages${count}`,
    );
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain(`Show ${count - 5} more`);
  });

  it("moves pages across the cap with the same ordering verbs in both menus", async () => {
    for (let index = 1; index <= 6; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    renderSidebarItems();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Plugin 1" }));
    expect(
      await screen.findByRole("menuitem", { name: "Move to overflow" }),
    ).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Plugin 1 panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to overflow" }),
    );
    await waitFor(() => {
      expect(panelRowNames()).toEqual([
        "Plugin 2",
        "Plugin 3",
        "Plugin 4",
        "Plugin 5",
        "Plugin 6",
      ]);
    });
    expect(screen.queryByText("Hide from sidebar")).toBeNull();

    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Plugin 1 panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to top" }),
    );
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    await waitFor(() => {
      expect(panelRowNames().slice(0, 5)).toEqual([
        "Plugin 1",
        "Plugin 2",
        "Plugin 3",
        "Plugin 4",
        "Plugin 5",
      ]);
    });
  });

  it("persists the expanded overflow preference", async () => {
    for (let index = 1; index <= 6; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    const first = renderSidebarItems();
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    await waitFor(() => expect(panelRowNames()).toHaveLength(6));
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOverflowExpanded"),
    ).toBe("true");

    first.unmount();
    renderSidebarItems();
    expect(panelRowNames()).toHaveLength(6);
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("Show less");
  });

  it("promotes the active overflow page without changing stored order", () => {
    for (let index = 1; index <= 9; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    renderSidebarItems({ initialEntry: "/plugins/plugin-9/main" });

    expect(panelRowNames()).toEqual([
      "Plugin 1",
      "Plugin 2",
      "Plugin 3",
      "Plugin 4",
      "Plugin 9",
    ]);
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "[]",
      ),
    ).toEqual(
      Array.from({ length: 9 }, (_, index) => `plugin-${index + 1}/main`),
    );
  });

  it("migrates hidden pages to the end once and clears the hidden set", async () => {
    for (let index = 1; index <= 9; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    window.localStorage.setItem(
      "bb.sidebar.pluginPanelOrder",
      JSON.stringify(
        Array.from({ length: 9 }, (_, index) => `plugin-${index + 1}/main`),
      ),
    );
    window.localStorage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["plugin-4/main", "plugin-2/main"]),
    );

    renderSidebarItems();

    await waitFor(() => {
      expect(window.localStorage.getItem("bb.sidebar.hiddenPluginPanels")).toBe(
        "[]",
      );
    });
    expect(panelRowNames()).toEqual([
      "Plugin 1",
      "Plugin 3",
      "Plugin 5",
      "Plugin 6",
      "Plugin 7",
    ]);
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "[]",
      ).slice(-2),
    ).toEqual(["plugin-2/main", "plugin-4/main"]);
  });

  it("preserves the felt state for four pages with two hidden", async () => {
    for (let index = 1; index <= 4; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }

    renderSidebarItems({
      storedOrder: [
        "plugin-3/main",
        "plugin-1/main",
        "plugin-4/main",
        "plugin-2/main",
      ],
      hiddenKeys: ["plugin-4/main", "plugin-2/main"],
    });

    expect(panelRowNames()).toEqual(["Plugin 3", "Plugin 1"]);
    expect(screen.queryByTestId("plugin-nav-sidebar-heading")).toBeNull();
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("Show 2 more");
    await waitFor(() => {
      expect(window.localStorage.getItem("bb.sidebar.hiddenPluginPanels")).toBe(
        "[]",
      );
    });
  });

  it("keeps an all-hidden list collapsed while temporarily surfacing the active page", async () => {
    for (let index = 1; index <= 4; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    const hiddenKeys = Array.from(
      { length: 4 },
      (_, index) => `plugin-${index + 1}/main`,
    );

    const first = renderSidebarItems({ hiddenKeys });
    expect(panelRowNames()).toEqual([]);
    expect(screen.queryByTestId("plugin-nav-sidebar-heading")).toBeNull();
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("Show 4 more");
    await waitFor(() => {
      expect(
        window.localStorage.getItem(
          "bb.sidebar.pluginPanelMigratedVisibleLimit",
        ),
      ).toBe("0");
    });

    first.unmount();
    renderSidebarItems({
      initialEntry: "/plugins/plugin-4/main",
      migratedVisibleLimit: 0,
    });
    expect(panelRowNames()).toEqual(["Plugin 4"]);
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("Show 3 more");
  });

  it("returns to the plain list after the migrated overflow is emptied", async () => {
    for (let index = 1; index <= 4; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    renderSidebarItems({
      storedOrder: [
        "plugin-1/main",
        "plugin-2/main",
        "plugin-3/main",
        "plugin-4/main",
      ],
      hiddenKeys: ["plugin-3/main", "plugin-4/main"],
    });
    await waitFor(() => {
      expect(window.localStorage.getItem("bb.sidebar.hiddenPluginPanels")).toBe(
        "[]",
      );
    });

    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Plugin 3 panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to top" }),
    );
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    await waitFor(() => {
      expect(
        screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
      ).toContain("Show 1 more");
    });
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Plugin 4 panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to top" }),
    );
    await waitFor(() => {
      expect(panelRowNames()).toHaveLength(4);
      expect(
        screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
      ).toBeNull();
      expect(
        window.localStorage.getItem(
          "bb.sidebar.pluginPanelMigratedVisibleLimit",
        ),
      ).toBeNull();
    });
  });

  it("leaves the legacy Extensions key for its owning migration", async () => {
    for (let index = 1; index <= 4; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    renderSidebarItems({
      hiddenKeys: ["plugin-4/main", "__builtin__/tools"],
    });

    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem("bb.sidebar.hiddenPluginPanels") ?? "[]",
        ),
      ).toEqual(["__builtin__/tools"]);
    });
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain("__builtin__/tools");
    fireEvent.click(screen.getByTestId("plugin-nav-sidebar-overflow-toggle"));
    expect(panelRowNames()).toEqual([
      "Plugin 1",
      "Plugin 2",
      "Plugin 3",
      "Plugin 4",
    ]);
  });

  it("keeps a newly installed page at the end when five already show", async () => {
    for (let index = 1; index <= 5; index += 1) {
      registerPanel(`plugin-${index}`, `Plugin ${index}`);
    }
    renderSidebarItems();

    act(() => registerPanel("plugin-6", "Plugin 6"));

    await waitFor(() => {
      expect(panelRowNames()).toEqual([
        "Plugin 1",
        "Plugin 2",
        "Plugin 3",
        "Plugin 4",
        "Plugin 5",
      ]);
    });
    expect(
      screen.getByTestId("plugin-nav-sidebar-overflow-toggle").textContent,
    ).toContain("Show 1 more");
  });

  it("renders plugin groups and resolves a lazy submenu only when opened", async () => {
    const run = vi.fn();
    const lazyItems = vi.fn(async () => [
      { id: "api", label: "API reference", run },
    ]);
    registerPanel("docs", "Docs", undefined, [
      {
        id: "docs",
        label: "API docs",
        items: [
          { id: "overview", label: "Open overview", run },
          { id: "surfaces", label: "API surfaces", items: lazyItems },
        ],
      },
    ]);
    renderSidebarItems({ splitEnabled: true });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    expect(await screen.findByText("API docs")).not.toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Open in split" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Plugin settings" }),
    ).not.toBeNull();
    expect(lazyItems).not.toHaveBeenCalled();

    const submenuTrigger = screen.getByRole("menuitem", {
      name: "API surfaces",
    });
    submenuTrigger.focus();
    fireEvent.keyDown(submenuTrigger, { key: "ArrowRight" });
    expect(
      await screen.findByRole("menuitem", { name: "API reference" }),
    ).not.toBeNull();
    expect(lazyItems).toHaveBeenCalledTimes(1);
  });

  it("contains failing plugin actions and lazy resolvers", async () => {
    const actionError = vi.spyOn(appToast, "error").mockImplementation(() => 1);
    registerPanel("docs", "Docs", undefined, [
      {
        id: "broken",
        items: [
          {
            id: "action",
            label: "Broken action",
            run: () => {
              throw new Error("action failed");
            },
          },
          {
            id: "submenu",
            label: "Broken submenu",
            items: async () => {
              throw new Error("resolver failed");
            },
          },
        ],
      },
    ]);
    renderSidebarItems();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Broken action" }),
    );
    await waitFor(() => {
      expect(actionError).toHaveBeenCalledWith("Could not run plugin action", {
        description: "action failed",
      });
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    const submenuTrigger = await screen.findByRole("menuitem", {
      name: "Broken submenu",
    });
    submenuTrigger.focus();
    fireEvent.keyDown(submenuTrigger, { key: "ArrowRight" });
    expect(await screen.findByText("Could not load")).not.toBeNull();
  });

  it("opens Plugin settings in Extensions and omits split on compact viewports", async () => {
    registerPanel("docs", "Docs");
    const first = renderSidebarItems({ splitEnabled: true });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Plugin settings" }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins/docs",
    );

    first.unmount();
    renderSidebarItems({ compactViewport: true, splitEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Docs panel options" }));
    expect(
      await screen.findByRole("menuitem", { name: "Plugin settings" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Open in split" }),
    ).toBeNull();
  });

  it("draws no empty menu for a remembered row with no applicable action", () => {
    writeLastKnownPluginNavPanelChrome([
      {
        pluginId: "docs",
        id: "main",
        title: "Docs",
        icon: "FileText",
        path: "main",
      },
    ]);
    renderSidebarItems({ bootComplete: false });

    expect(screen.getByRole("button", { name: "Docs" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Docs panel options" }),
    ).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
    expect(screen.queryByRole("menu")).toBeNull();
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

  it("orders only plugin pages and never seeds a host-owned Extensions key", async () => {
    registerPanel("docs", "Docs");
    renderSidebarItems({ storedOrder: ["docs/main"] });

    await waitFor(() => expect(panelRowNames()).toEqual(["Docs"]));
    expect(
      window.localStorage.getItem("bb.sidebar.pluginPanelOrder") ?? "",
    ).not.toContain("__builtin__");
  });
});

function LocationPath() {
  return <span data-testid="location-path">{useLocation().pathname}</span>;
}

describe("ExtensionsNavSidebarItem", () => {
  it("navigates independently of plugin ordering and has no panel menu", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ExtensionsNavSidebarItem routePath="/extensions/plugins" />
        <LocationPath />
      </MemoryRouter>,
    );

    const extensionsRow = screen.getByRole("button", { name: "Extensions" });
    fireEvent.click(extensionsRow);

    expect(screen.getByTestId("location-path").textContent).toBe(
      "/extensions/plugins",
    );
    expect(
      screen.queryByRole("button", { name: "Extensions panel options" }),
    ).toBeNull();

    // The swap is CSS on the row's :hover, which jsdom cannot evaluate. What is
    // testable is that both glyphs share one swap container without reflow.
    expect(extensionsRow).toBeTruthy();
    const swap = extensionsRow.querySelector(".bb-sidebar-row-icon-swap");
    expect(swap).toBeTruthy();
    expect(
      swap?.querySelector('.bb-sidebar-row-icon-rest[data-icon="Toolbox"]'),
    ).toBeTruthy();
    expect(
      swap?.querySelector('.bb-sidebar-row-icon-hover[data-icon="ToolCase"]'),
    ).toBeTruthy();
  });
});
