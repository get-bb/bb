// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useEffect,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "./PluginSlotMount";
import {
  type BuiltInSidebarNavEntry,
  ExtensionsNavSidebarItem,
  PluginNavSidebarItems,
} from "./PluginNavSidebarItems";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "./pluginNavSidebarAtoms";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { countPanes, findPaneByContent } from "@/lib/split-layout";

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
        },
      ],
    }),
  );
}

interface RenderSidebarItemsOptions {
  builtInEntries?: readonly BuiltInSidebarNavEntry[];
  storedOrder?: string[];
  storedVisibleKeys?: string[] | null;
  compactViewport?: boolean;
  compactCustomizeMode?: boolean;
  onCompactCustomizeModeChange?: (isCustomizing: boolean) => void;
  splitEnabled?: boolean;
}

function PluginNavSidebarItemsHarness({
  options,
}: {
  options: RenderSidebarItemsOptions;
}) {
  const [compactCustomizeMode, setCompactCustomizeMode] = useState(
    options.compactCustomizeMode ?? false,
  );
  const compactControlProps = options.compactViewport
    ? {
        compactCustomizeMode,
        onCompactCustomizeModeChange: (isCustomizing: boolean) => {
          setCompactCustomizeMode(isCustomizing);
          options.onCompactCustomizeModeChange?.(isCustomizing);
        },
      }
    : {};

  return (
    <PluginNavSidebarItems
      builtInEntries={options.builtInEntries}
      splitEnabled={options.splitEnabled}
      {...compactControlProps}
    />
  );
}

function renderSidebarItems(options: RenderSidebarItemsOptions = {}) {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  if ("storedVisibleKeys" in options) {
    store.set(
      pluginNavVisiblePanelKeysAtom,
      options.storedVisibleKeys ?? null,
    );
  }
  if (options.splitEnabled) {
    store.set(splitLayoutAtom, {
      root: {
        type: "pane",
        paneId: "pane-1",
        content: { kind: "new-thread" },
      },
      focusedPaneId: "pane-1",
    });
  }
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <MemoryRouter initialEntries={["/"]}>
            <SidebarProvider>
              <PluginNavSidebarItemsHarness options={options} />
              <LocationProbe />
            </SidebarProvider>
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </CompactViewportOverrideProvider>,
  );
  return { ...view, store };
}

function LocationProbe() {
  return <output data-testid="location-path">{useLocation().pathname}</output>;
}

function panelRowNames(labels: readonly string[] = ["Docs", "GitHub"]): string[] {
  const rowLabels = new Set(labels);
  const container = screen.queryByTestId("plugin-nav-sidebar-items");
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-sidebar-navigation-item]"),
  )
    .map((row) => row.textContent?.trim() ?? "")
    .filter((label) => rowLabels.has(label));
}

function builtInEntry(
  id: string,
  title: string,
  onActivate: (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void = vi.fn(),
): BuiltInSidebarNavEntry {
  return {
    kind: "built-in",
    pluginId: "__bb__",
    id,
    title,
    icon: <span aria-hidden="true" />,
    content: <button type="button">{title}</button>,
    onActivate,
  };
}

function customizeRows(): HTMLElement[] {
  return Array.from(
    screen
      .getByRole("list", { name: "Sidebar navigation" })
      .querySelectorAll<HTMLElement>("[data-plugin-nav-customize-item]"),
  );
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
  it("collapses the entire subsection with zero traditional plugins", () => {
    renderSidebarItems();

    expect(screen.queryByTestId("plugin-nav-sidebar-items")).toBeNull();
    expect(screen.queryByText("Plugins")).toBeNull();
  });

  it("shows one plugin with a unified customization entry point and no section label", () => {
    registerPanel("docs", "Docs");
    renderSidebarItems();

    expect(screen.queryByText("Plugins")).toBeNull();
    expect(panelRowNames(["Docs"])).toEqual(["Docs"]);
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    ).not.toBeNull();
  });

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
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move to top" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Move to overflow" }),
    ).toBeNull();

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

  it("uses an in-place customization mode instead of a drawer on compact viewports", () => {
    const onCompactCustomizeModeChange = vi.fn();
    renderSidebarItems({
      compactViewport: true,
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
      onCompactCustomizeModeChange,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );

    expect(onCompactCustomizeModeChange).toHaveBeenCalledWith(true);
    expect(
      screen.getByTestId("sidebar-navigation-customize-inline"),
    ).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to sidebar" })).toBe(
      document.activeElement,
    );
    expect(
      screen.queryByRole("button", { name: "Customize sidebar navigation" }),
    ).toBeNull();
    const firstCustomizeRow = customizeRows()[0];
    const firstDragHandle = firstCustomizeRow?.querySelector<HTMLElement>(
      "[data-plugin-nav-customize-drag-handle]",
    );
    const firstCheckbox = within(firstCustomizeRow as HTMLElement).getByRole(
      "checkbox",
    );
    expect(
      firstCustomizeRow?.classList.contains("max-md:pointer-coarse:h-9"),
    ).toBe(true);
    expect(
      firstDragHandle?.classList.contains("max-md:pointer-coarse:h-9"),
    ).toBe(true);
    expect(
      firstDragHandle?.classList.contains("max-md:pointer-coarse:w-9"),
    ).toBe(true);
    expect(
      firstCheckbox
        .closest("label")
        ?.classList.contains("max-md:pointer-coarse:h-9"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back to sidebar" }));

    expect(onCompactCustomizeModeChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByTestId("sidebar-navigation-customize-inline"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    ).toBe(document.activeElement);
  });

  it("keeps compact visibility changes in place and closes the mode when launching", () => {
    const onActivate = vi.fn();
    const { store } = renderSidebarItems({
      compactViewport: true,
      builtInEntries: [builtInEntry("new-thread", "New thread", onActivate)],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show New thread in sidebar" }),
    );

    expect(
      screen.getByTestId("sidebar-navigation-customize-inline"),
    ).not.toBeNull();
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("sidebar-navigation-customize-inline"),
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps the desktop customization popover", () => {
    renderSidebarItems({
      builtInEntries: [builtInEntry("new-thread", "New thread")],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );

    expect(
      screen.getByRole("list", { name: "Sidebar navigation" }),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("sidebar-navigation-customize-inline"),
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

  it("shows only the first three plugins directly and lists every plugin in the menu", () => {
    const labels = ["One", "Two", "Three", "Four", "Five", "Six"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));

    renderSidebarItems();

    expect(panelRowNames(labels)).toEqual(labels.slice(0, 3));
    expect(
      screen.queryByTestId("plugin-nav-sidebar-overflow-toggle"),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );
    expect(customizeRows().map((row) => row.textContent?.trim())).toEqual(
      labels,
    );
    expect(
      screen.queryByRole("button", { name: "Four panel options" }),
    ).toBeNull();
  });

  it("keeps built-ins visible without letting their order consume plugin slots", () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
      storedOrder: [
        "plugin-0/main",
        "__bb__/new-thread",
        "plugin-1/main",
        "__bb__/search-threads",
        "plugin-2/main",
        "plugin-3/main",
      ],
    });

    expect(
      Array.from(
        screen
          .getByTestId("plugin-nav-sidebar-items")
          .querySelectorAll("[data-sidebar-navigation-item]"),
      ).map((row) => row.getAttribute("data-sidebar-navigation-item")),
    ).toEqual([
      "plugin-0/main",
      "__bb__/new-thread",
      "plugin-1/main",
      "__bb__/search-threads",
      "plugin-2/main",
    ]);
  });

  it("keeps launch and visibility as distinct targets with a clear row hover state", async () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    const { store, unmount } = renderSidebarItems();

    const trigger = screen.getByRole("button", {
      name: "Customize sidebar navigation",
    });
    expect(trigger.querySelector("svg")).not.toBeNull();

    fireEvent.click(trigger);
    const choices = screen.getAllByRole("checkbox");
    await waitFor(() =>
      expect(
        document.activeElement?.getAttribute(
          "data-sidebar-navigation-customize-launch",
        ),
      ).toBe("plugin-0/main"),
    );
    expect(choices.map((choice) => choice.getAttribute("data-state"))).toEqual([
      "checked",
      "checked",
      "checked",
      "unchecked",
    ]);
    expect(
      document.querySelectorAll("[data-plugin-nav-customize-drag-handle]"),
    ).toHaveLength(4);
    expect(customizeRows()[0]?.classList.contains("hover:bg-state-hover")).toBe(
      true,
    );

    fireEvent.click(choices[0]!);
    expect(
      screen.getByRole("list", { name: "Sidebar navigation" }),
    ).not.toBeNull();
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "plugin-1/main",
      "plugin-2/main",
    ]);
    expect(panelRowNames(labels)).toEqual(["Two", "Three"]);

    unmount();
    renderSidebarItems();
    expect(panelRowNames(labels)).toEqual(["Two", "Three"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );

    const hiddenRow = document.querySelector<HTMLElement>(
      '[data-plugin-nav-customize-item="plugin-0/main"]',
    );
    expect(hiddenRow).not.toBeNull();
    fireEvent.click(
      within(hiddenRow as HTMLElement).getByRole("button", { name: "One" }),
    );

    expect(screen.getByTestId("location-path").textContent).toBe(
      getPluginPanelRoutePath({ pluginId: "plugin-0", path: "main" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Sidebar navigation" }),
      ).toBeNull(),
    );
  });

  it("seeds newly introduced built-ins without overriding existing plugin visibility", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
      storedOrder: ["tasks/main", "docs/main"],
      storedVisibleKeys: ["docs/main"],
    });

    expect(
      Array.from(
        screen
          .getByTestId("plugin-nav-sidebar-items")
          .querySelectorAll("[data-sidebar-navigation-item]"),
      ).map((row) => row.getAttribute("data-sidebar-navigation-item")),
    ).toEqual(["__bb__/new-thread", "__bb__/search-threads", "docs/main"]);
  });

  it("keeps Customize on the New thread row without stranding it when the row is hidden", () => {
    renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
    });

    const trigger = screen.getByRole("button", {
      name: "Customize sidebar navigation",
    });
    expect(
      trigger
        .closest("[data-sidebar-navigation-item]")
        ?.getAttribute("data-sidebar-navigation-item"),
    ).toBe("__bb__/new-thread");

    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show New thread in sidebar" }),
    );

    expect(
      screen.getByRole("list", { name: "Sidebar navigation" }),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Customize sidebar navigation" })
        .closest("[data-sidebar-navigation-item]"),
    ).toBeNull();
  });

  it("applies one persisted mixed order to direct rows and the menu", () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    const newThread = builtInEntry("new-thread", "New thread");
    const searchThreads = builtInEntry("search-threads", "Search threads");
    renderSidebarItems({
      builtInEntries: [newThread, searchThreads],
      storedOrder: [
        "plugin-3/main",
        "__bb__/search-threads",
        "plugin-1/main",
        "__bb__/new-thread",
        "plugin-0/main",
        "plugin-2/main",
      ],
      storedVisibleKeys: [
        "plugin-3/main",
        "__bb__/search-threads",
        "__bb__/new-thread",
        "plugin-0/main",
      ],
    });

    expect(
      Array.from(
        screen
          .getByTestId("plugin-nav-sidebar-items")
          .querySelectorAll("[data-sidebar-navigation-item]"),
      ).map((row) => row.getAttribute("data-sidebar-navigation-item")),
    ).toEqual([
      "plugin-3/main",
      "__bb__/search-threads",
      "__bb__/new-thread",
      "plugin-0/main",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );
    expect(customizeRows().map((row) => row.textContent?.trim())).toEqual([
      "Four",
      "Search threads",
      "Two",
      "New thread",
      "One",
      "Three",
    ]);
    expect(
      screen
        .getAllByRole("checkbox")
        .map((choice) => choice.getAttribute("data-state")),
    ).toEqual([
      "checked",
      "checked",
      "unchecked",
      "checked",
      "checked",
      "unchecked",
    ]);
  });

  it("launches a built-in row from the menu without changing its visibility", async () => {
    const onActivate = vi.fn();
    renderSidebarItems({
      builtInEntries: [builtInEntry("new-thread", "New thread", onActivate)],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );
    const row = customizeRows()[0];
    expect(row).toBeDefined();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "New thread" }),
    );

    expect(onActivate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Sidebar navigation" }),
      ).toBeNull(),
    );
  });

  it("preserves modifier-click when launching a built-in from Customize", async () => {
    const onActivate = vi.fn();
    renderSidebarItems({
      builtInEntries: [builtInEntry("new-thread", "New thread", onActivate)],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );
    const row = customizeRows()[0];
    expect(row).toBeDefined();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "New thread" }),
      { metaKey: true },
    );

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate.mock.calls[0]?.[0]).toMatchObject({ metaKey: true });
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Sidebar navigation" }),
      ).toBeNull(),
    );
  });

  it("preserves modifier-click when launching a plugin from Customize", async () => {
    registerPanel("docs", "Docs");
    const { store } = renderSidebarItems({ splitEnabled: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize sidebar navigation" }),
    );
    const row = customizeRows()[0];
    expect(row).toBeDefined();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Docs" }),
      { metaKey: true },
    );

    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(2);
    expect(
      findPaneByContent(layout!.root, {
        kind: "plugin-panel",
        pluginId: "docs",
        panelPath: "main",
        subPath: "",
      }),
    ).not.toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Sidebar navigation" }),
      ).toBeNull(),
    );
  });

  it("keeps Automations on the plugin row contract with a unified identity", () => {
    registerPanel(AUTOMATIONS_PLUGIN_ID, "Automations", () => (
      <span>Scheduled</span>
    ));
    const view = renderSidebarItems({ splitEnabled: true });

    expect(
      view.container.querySelector(
        '[data-sidebar-navigation-item="__bb__/automations"]',
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Automations panel options" }),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]")
        ?.textContent,
    ).toBe("Scheduled");

    fireEvent.click(screen.getByRole("button", { name: "Automations" }), {
      metaKey: true,
    });
    const layout = view.store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(2);
    expect(
      findPaneByContent(layout!.root, {
        kind: "plugin-panel",
        pluginId: AUTOMATIONS_PLUGIN_ID,
        panelPath: "main",
        subPath: "",
      }),
    ).not.toBeNull();
  });
});

describe("ExtensionsNavSidebarItem", () => {
  it("is host-owned and has no plugin-panel options menu", () => {
    render(
      <MemoryRouter>
        <ExtensionsNavSidebarItem routePath="/extensions/plugins" />
      </MemoryRouter>,
    );

    const row = screen.getByRole("button", { name: "Extensions" });
    expect(row.querySelector(".bb-sidebar-row-icon-swap")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Extensions panel options" }),
    ).toBeNull();
  });
});
