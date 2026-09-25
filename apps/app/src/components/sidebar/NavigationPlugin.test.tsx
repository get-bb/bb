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
import { useEffect, type ComponentType } from "react";
import { createStore } from "jotai";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import { SIDEBAR_CONTROL_STATE_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { SidebarVisibilityCustomize } from "@/components/sidebar/SidebarVisibilityControls";
import { useSidebarReorderDnd as useHostSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "@/components/plugin/PluginSlotMount";
import { appToast } from "@/components/ui/app-toast";
import {
  makeInstalledPlugin,
  makePluginRegistrationSet as registrationSet,
} from "@/test/fixtures/plugins";
import { registerNavigationPlugin } from "@/test/fixtures/navigation-plugin";
import {
  renderNavigationHarness,
  type NavigationHarnessOptions,
} from "@/test/navigation-harness";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "@/components/plugin/pluginNavSidebarAtoms";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  setServerPluginsStarting,
  setPluginFrontendReconcilePending,
} from "@/lib/plugin-frontend-boot-state";
import { writeLastKnownPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  countPanes,
  findPaneByContent,
  type SplitLayout,
} from "@/lib/split-layout";
import { usePublishPluginDetailOpener } from "@/components/plugin/plugin-detail-opener";
import { useSidebarReorderDnd as usePluginSidebarReorderDnd } from "../../../../../plugins/navigation/app/ui/useSidebarReorderDnd";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  onNewChat: vi.fn(),
  onSearchThreads: vi.fn(),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/components/commands/AppCommandProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/commands/AppCommandProvider")
  >()),
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    getShortcutCommand: () => null,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock(
  "../../../../../plugins/navigation/app/ui/useSidebarReorderDnd",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../../plugins/navigation/app/ui/useSidebarReorderDnd")
      >();
    return {
      ...actual,
      useSidebarReorderDnd: vi.fn(actual.useSidebarReorderDnd),
    };
  },
);

vi.mock("@/components/sidebar/useSidebarReorderDnd", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/sidebar/useSidebarReorderDnd")
    >();
  return {
    ...actual,
    useSidebarReorderDnd: vi.fn(actual.useSidebarReorderDnd),
  };
});

const HOST_KEYS = [
  "__bb__/new-thread",
  "__bb__/search-threads",
  "__bb__/extensions",
  "__bb__/skills",
];
const DEFAULT_VISIBLE_HOST_KEYS = [
  "__bb__/new-thread",
  "__bb__/extensions",
  "__bb__/skills",
];

function disabledPluginMutationResponse(id: string) {
  return {
    ok: true,
    plugin: makeInstalledPlugin({
      id,
      enabled: false,
      status: "disabled",
      app: { hasApp: true, bundle: null },
    }),
  };
}

function dragEndEvent(activeId: string, overId: string): DragEndEvent {
  return {
    active: {
      id: activeId,
      data: { current: {} },
      rect: { current: { initial: null, translated: null } },
    },
    over: {
      id: overId,
      data: { current: {} },
      rect: new DOMRect(),
      disabled: false,
    },
    activatorEvent: new Event("pointerdown"),
    collisions: [],
    delta: { x: 0, y: 0 },
  };
}

function reorderSidebar(
  activeId: string,
  overId: string,
  surface: "sidebar" | "customize" = "sidebar",
) {
  const options = (
    surface === "sidebar"
      ? vi.mocked(usePluginSidebarReorderDnd)
      : vi.mocked(useHostSidebarReorderDnd)
  ).mock.lastCall?.[0];
  if (!options) throw new Error(`${surface} reorder handler is not mounted`);
  act(() => options.onDragEnd(dragEndEvent(activeId, overId)));
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

interface RenderNavigationOptions extends Omit<
  NavigationHarnessOptions,
  "store"
> {
  storedOrder?: string[];
  storedVisibleKeys?: string[] | null;
  initialLayout?: SplitLayout;
}

function renderNavigation(options: RenderNavigationOptions = {}) {
  const { storedOrder, storedVisibleKeys, initialLayout, ...harness } = options;
  const store = createStore();
  if (storedOrder) store.set(pluginNavPanelOrderAtom, storedOrder);
  if ("storedVisibleKeys" in options) {
    store.set(pluginNavVisiblePanelKeysAtom, storedVisibleKeys ?? null);
  }
  if (harness.splitEnabled) {
    store.set(splitLayoutAtom, {
      root: {
        type: "pane",
        paneId: "pane-1",
        content: { kind: "new-thread" },
      },
      focusedPaneId: "pane-1",
    });
  }
  if (initialLayout) store.set(splitLayoutAtom, initialLayout);
  return renderNavigationHarness({
    onNewChat: mocks.onNewChat,
    onSearchThreads: mocks.onSearchThreads,
    ...harness,
    store,
  });
}

function navigationRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-testid="plugin-nav-sidebar-items"]:not([data-sidebar-navigation-customize-mode])',
  );
}

function visibleRowKeys(): string[] {
  const root = navigationRoot();
  if (!root) return [];
  return Array.from(
    root.querySelectorAll("[data-sidebar-navigation-item]"),
    (row) => row.getAttribute("data-sidebar-navigation-item") ?? "",
  );
}

function panelRowNames(
  labels: readonly string[] = ["Docs", "GitHub"],
): string[] {
  const rowLabels = new Set(labels);
  const root = navigationRoot();
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-sidebar-navigation-item]"),
  )
    .map((row) => row.textContent?.trim() ?? "")
    .filter((label) => rowLabels.has(label));
}

function customizeRows(): HTMLElement[] {
  return Array.from(
    screen
      .getByRole("list", { name: "Sidebar navigation" })
      .querySelectorAll<HTMLElement>("[data-plugin-nav-customize-item]"),
  );
}

function moreTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "More sidebar navigation" });
}

function menuEntryLabels(): (string | undefined)[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-sidebar-navigation-more-item], [data-testid="sidebar-navigation-customize-trigger"]',
    ),
    (item) => item.textContent?.trim(),
  );
}

async function openMoreMenu(): Promise<(string | undefined)[]> {
  fireEvent.click(moreTrigger());
  await screen.findByRole("button", { name: "Customize sidebar" });
  return menuEntryLabels();
}

async function openCustomizeFromMore(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
  return await screen.findByRole("list", { name: "Sidebar navigation" });
}

async function openCustomizeFromContextMenu(
  target: HTMLElement,
): Promise<HTMLElement> {
  fireEvent.contextMenu(target);
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Customize sidebar" }),
  );
  return await screen.findByRole("list", { name: "Sidebar navigation" });
}

beforeAll(async () => {
  render(
    <SidebarVisibilityCustomize
      items={[]}
      listLabel="Preloaded editor"
      onDone={() => {}}
      onReorder={() => {}}
      onVisibleChange={() => {}}
      title="Preloaded editor"
      variant="card"
      visibleIds={[]}
    />,
  );
  await screen.findByRole("list", { name: "Preloaded editor" });
  cleanup();
});

beforeEach(async () => {
  vi.clearAllMocks();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await registerNavigationPlugin();
});

afterEach(() => {
  cleanup();
  resetPluginFrontendBootStateForTest();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Navigation plugin in the sidebar navigation region", () => {
  it("keeps built-in actions visible without placeholders during startup", () => {
    resetPluginFrontendBootStateForTest();
    renderNavigation();
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
    expect(screen.queryByTestId("plugin-nav-loading-placeholders")).toBeNull();
    expect(
      document.querySelector("[data-sidebar-navigation-placeholder]"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
    act(() => markPluginFrontendsSettled());
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
    expect(screen.queryByTestId("plugin-nav-loading-placeholders")).toBeNull();
    expect(
      document.querySelector("[data-sidebar-navigation-placeholder]"),
    ).toBeNull();
  });

  it("keeps remembered labels while the server starts, then reveals ready panels in place", () => {
    writeLastKnownPluginNavPanelChrome([
      {
        pluginId: "docs",
        id: "main",
        path: "main",
        title: "Docs",
        icon: "Puzzle",
      },
    ]);
    setServerPluginsStarting(true);
    renderNavigation();
    const row = screen.getByRole("button", { name: "Docs" });
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("plugin-nav-loading-placeholders")).toBeNull();
    act(() => {
      setPluginFrontendReconcilePending(true);
      setServerPluginsStarting(false);
      registerPanel("docs", "Docs");
    });
    expect(screen.getByRole("button", { name: "Docs" })).toBe(row);
    expect(row.hasAttribute("aria-busy")).toBe(false);
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
    act(() => setPluginFrontendReconcilePending(false));
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
  });

  it("shows only the default host rows when no plugin panels are registered", async () => {
    renderNavigation();

    expect(visibleRowKeys()).toEqual(DEFAULT_VISIBLE_HOST_KEYS);
    expect(await openMoreMenu()).toEqual([
      "Search threads",
      "Customize sidebar",
    ]);
  });

  it.each([
    ["Plugins", "Plug02", "/plugins"],
    ["Skills", "Zap", "/skills"],
  ] as const)(
    "renders the static %s row without plugin-panel options and routes to it",
    (title, icon, routePath) => {
      renderNavigation();

      const row = screen.getByRole("button", { name: title });
      expect(row.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
      expect(
        screen.queryByRole("button", { name: `${title} panel options` }),
      ).toBeNull();
      fireEvent.click(row);
      expect(screen.getByTestId("location-path").textContent).toBe(routePath);
      expect(
        screen
          .getByRole("button", { name: title })
          .getAttribute("aria-current"),
      ).toBe("page");
    },
  );

  it("shows one plugin directly with its row options", () => {
    registerPanel("docs", "Docs");
    renderNavigation({
      storedOrder: [...HOST_KEYS, "docs/main"],
      storedVisibleKeys: [...HOST_KEYS, "docs/main"],
    });

    expect(panelRowNames(["Docs"])).toEqual(["Docs"]);
    expect(visibleRowKeys()).toEqual([...HOST_KEYS, "docs/main"]);
    expect(screen.queryByTestId("sidebar-navigation-more-row")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Customize sidebar navigation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Docs panel options" }),
    ).not.toBeNull();
  });

  it("keeps an accessory-less plugin row unchanged", () => {
    registerPanel("docs", "Docs");

    const view = renderNavigation();

    expect(screen.getByRole("button", { name: "Docs" }).textContent).toBe(
      "Docs",
    );
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-7"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-18"),
    ).toBe(false);
    const options = screen.getByRole("button", {
      name: "Docs panel options",
    });
    for (const token of SIDEBAR_CONTROL_STATE_CLASS.split(" ")) {
      expect(options.classList.contains(token)).toBe(true);
    }
    expect(
      options.classList.contains("data-[state=open]:bg-sidebar-accent"),
    ).toBe(false);
    expect(options.classList.contains("hover:text-foreground")).toBe(false);
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("keeps the panel options trigger visible on mobile", () => {
    registerPanel("docs", "Docs");

    renderNavigation();

    expect(
      screen
        .getByRole("button", { name: "Docs panel options" })
        .closest("[data-sidebar-hover-actions-mobile]")
        ?.getAttribute("data-sidebar-hover-actions-mobile"),
    ).toBe("always");
  });

  it.each([false, true])(
    "uses the focused plugin action set for the options button and right-click (compact=%s)",
    async (compactViewport) => {
      registerPanel("docs", "Docs");
      renderNavigation({ splitEnabled: true, compactViewport });

      const trigger = screen.getByRole("button", {
        name: "Docs panel options",
      });
      if (compactViewport) {
        fireEvent.click(trigger);
      } else {
        fireEvent.pointerDown(trigger, { button: 0 });
      }
      await screen.findByRole("menuitem", { name: "Hide from sidebar" });
      const dropdownRole = compactViewport ? "dialog" : "menu";
      const dropdownMenu = screen.getByRole(dropdownRole);
      const expected = [
        ...(compactViewport ? [] : [["Open in split", "Columns2"]]),
        ["View details", "Info"],
        ["Hide from sidebar", "EyeOff"],
        ["Disable", "Unavailable"],
      ] as const;
      const expectFocusedMenu = (menu: HTMLElement) => {
        expect(
          within(menu)
            .getAllByRole("menuitem")
            .map((item) => item.textContent?.trim()),
        ).toEqual(expected.map(([label]) => label));
        expect(within(menu).getAllByRole("separator")).toHaveLength(1);
        for (const [label, icon] of expected) {
          const iconElement = within(menu)
            .getByRole("menuitem", { name: label })
            .querySelector(`[data-icon="${icon}"]`);
          expect(iconElement).not.toBeNull();
          expect(iconElement?.hasAttribute("data-icon-root")).toBe(true);
        }
      };
      expectFocusedMenu(dropdownMenu);
      fireEvent.keyDown(dropdownMenu, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole(dropdownRole)).toBeNull());

      fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
      expectFocusedMenu(await screen.findByRole("menu"));
    },
  );

  it("hides an active plugin through the compact menu without disabling or navigating", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    registerPanel("docs", "Docs");
    const initialLayout: SplitLayout = {
      root: {
        type: "pane",
        paneId: "docs-pane",
        content: {
          kind: "plugin-panel",
          pluginId: "docs",
          panelPath: "main",
          subPath: "",
        },
      },
      focusedPaneId: "docs-pane",
    };
    const { store } = renderNavigation({
      compactViewport: true,
      initialEntries: ["/plugins/docs/main"],
      initialLayout,
    });
    fireEvent.click(screen.getByRole("button", { name: "Docs panel options" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual(
      DEFAULT_VISIBLE_HOST_KEYS,
    );
    expect(visibleRowKeys()).toEqual(DEFAULT_VISIBLE_HOST_KEYS);
    expect(store.get(splitLayoutAtom)).toEqual(initialLayout);
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/docs/main",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(moreTrigger());
    expect(await screen.findByRole("button", { name: "Docs" })).not.toBeNull();
    expect(menuEntryLabels()).toEqual([
      "Search threads",
      "Docs",
      "Customize sidebar",
    ]);
  });

  it("opens plugin details and omits split when the layout cannot split", async () => {
    registerPanel("docs", "Docs");
    renderNavigation();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "Open in split" }),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "View details" }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/docs",
    );
  });

  it("opens details in the active workspace without changing its route", async () => {
    const open = vi.fn(() => true);
    function Workspace() {
      usePublishPluginDetailOpener(open, true);
      return null;
    }
    render(<Workspace />);
    registerPanel("docs", "Docs");
    renderNavigation({ initialEntries: ["/plugins/docs/main"] });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "View details" }),
    );
    expect(open).toHaveBeenCalledWith({ pluginId: "docs", title: "Docs" });
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/docs/main",
    );
  });

  it.each([
    { pluginId: "docs", title: "Docs" },
    {
      pluginId: AUTOMATIONS_PLUGIN_ID,
      title: "Automations",
    },
  ])(
    "replaces $title with New thread after disabling",
    async ({ pluginId, title }) => {
      let completeDisable: (response: Response) => void = () => {};
      const fetchMock = vi.fn<typeof fetch>(
        () =>
          new Promise((resolve) => {
            completeDisable = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      registerPanel(pluginId, title);
      const { store } = renderNavigation({
        initialEntries: ["/skills", `/plugins/${pluginId}/main`],
        initialLayout: {
          root: {
            type: "pane",
            paneId: "docs",
            content: {
              kind: "plugin-panel",
              pluginId,
              panelPath: "main",
              subPath: "",
            },
          },
          focusedPaneId: "docs",
        },
      });

      fireEvent.pointerDown(
        screen.getByRole("button", { name: `${title} panel options` }),
        { button: 0 },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        `/plugins/${pluginId}/disable`,
      );
      expect(screen.getByTestId("location-path").textContent).toBe(
        `/plugins/${pluginId}/main`,
      );
      expect(appToast.success).not.toHaveBeenCalled();
      await act(async () => {
        completeDisable(
          new Response(
            JSON.stringify(disabledPluginMutationResponse(pluginId)),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      });
      await waitFor(() =>
        expect(screen.getByTestId("location-path").textContent).toBe("/"),
      );
      expect(store.get(splitLayoutAtom)?.root).toMatchObject({
        content: { kind: "new-thread" },
      });
      expect(appToast.success).toHaveBeenCalledWith(`${title} disabled`);
      fireEvent.click(screen.getByRole("button", { name: "History back" }));
      await waitFor(() =>
        expect(screen.getByTestId("location-path").textContent).toBe("/skills"),
      );
      fireEvent.click(screen.getByRole("button", { name: "History forward" }));
      await waitFor(() =>
        expect(screen.getByTestId("location-path").textContent).toBe("/"),
      );
    },
  );

  it.each(["docs", "github"])(
    "closes only the disabled plugin panes with %s focused",
    async (focusedPaneId) => {
      registerPanel("docs", "Docs");
      registerPanel("github", "GitHub");
      const { store } = renderNavigation({
        initialEntries: [`/plugins/${focusedPaneId}/main`],
        initialLayout: {
          root: {
            type: "split",
            dir: "row",
            sizes: [1, 1, 1],
            children: [
              {
                type: "pane",
                paneId: "docs",
                content: {
                  kind: "plugin-panel",
                  pluginId: "docs",
                  panelPath: "main",
                  subPath: "",
                },
              },
              {
                type: "pane",
                paneId: "github",
                content: {
                  kind: "plugin-panel",
                  pluginId: "github",
                  panelPath: "main",
                  subPath: "",
                },
              },
              {
                type: "pane",
                paneId: "docs-other",
                content: {
                  kind: "plugin-panel",
                  pluginId: "docs",
                  panelPath: "other",
                  subPath: "",
                },
              },
            ],
          },
          focusedPaneId,
        },
      });
      store.set(maximizedPaneIdAtom, "docs");
      const layoutsAtDisable: Array<SplitLayout | null> = [];
      const fetchMock = vi.fn<typeof fetch>(async () => {
        layoutsAtDisable.push(store.get(splitLayoutAtom));
        return new Response(
          JSON.stringify(disabledPluginMutationResponse("docs")),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Docs panel options" }),
        { button: 0 },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));
      await waitFor(() =>
        expect(appToast.success).toHaveBeenCalledWith("Docs disabled"),
      );
      const survivingLayout = {
        root: {
          type: "pane",
          paneId: "github",
          content: {
            kind: "plugin-panel",
            pluginId: "github",
            panelPath: "main",
            subPath: "",
          },
        },
        focusedPaneId: "github",
      };
      expect(layoutsAtDisable[0]?.root.type).toBe("split");
      expect(store.get(splitLayoutAtom)).toEqual(survivingLayout);
      expect(store.get(maximizedPaneIdAtom)).toBeNull();
      await waitFor(() =>
        expect(screen.getByTestId("location-path").textContent).toBe(
          "/plugins/github/main",
        ),
      );
    },
  );

  it("keeps the current workspace when disabling a plugin that is not open", async () => {
    registerPanel("docs", "Docs");
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(disabledPluginMutationResponse("docs")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { store } = renderNavigation({
      initialEntries: ["/"],
      splitEnabled: true,
    });
    const originalLayout = store.get(splitLayoutAtom);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));
    await waitFor(() =>
      expect(appToast.success).toHaveBeenCalledWith("Docs disabled"),
    );
    expect(store.get(splitLayoutAtom)).toBe(originalLayout);
    expect(screen.getByTestId("location-path").textContent).toBe("/");
  });

  it("bounds and truncates a long sidebar accessory", () => {
    registerPanel("tasks", "Tasks", () => (
      <span>123456789012345678901234567890</span>
    ));

    const view = renderNavigation();
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

    const view = renderNavigation();
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

    const view = renderNavigation({ compactViewport: true });

    expect(screen.getByRole("button", { name: "Tasks" })).not.toBeNull();
    expect(mounts).toBe(0);
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("uses an in-place customization mode from the More drawer on compact viewports", async () => {
    const onCustomizingChange = vi.fn();
    renderNavigation({
      compactViewport: true,
      onCustomizingChange,
    });

    expect(visibleRowKeys()).toEqual(DEFAULT_VISIBLE_HOST_KEYS);
    fireEvent.click(moreTrigger());
    fireEvent.click(
      await screen.findByRole("button", { name: "Customize sidebar" }),
    );

    expect(onCustomizingChange).toHaveBeenCalledWith(true);
    expect(
      await screen.findByTestId("sidebar-navigation-customize-inline"),
    ).not.toBeNull();
    expect(
      screen
        .queryByRole("list", { name: "Sidebar navigation" })
        ?.closest("[role=dialog]"),
    ).toBeFalsy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Back to sidebar" })).toBe(
        document.activeElement,
      ),
    );
    expect(
      screen.queryByRole("button", { name: "More sidebar navigation" }),
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

    expect(onCustomizingChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByTestId("sidebar-navigation-customize-inline"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).not.toBeNull();
    expect(moreTrigger()).toBe(document.activeElement);
  });

  it("keeps compact visibility changes in place and closes the mode when launching", async () => {
    const { store } = renderNavigation({
      compactViewport: true,
      storedOrder: HOST_KEYS,
      storedVisibleKeys: HOST_KEYS,
    });

    expect(screen.queryByTestId("sidebar-navigation-more-row")).toBeNull();
    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show New thread in sidebar" }),
    );

    expect(
      screen.getByTestId("sidebar-navigation-customize-inline"),
    ).not.toBeNull();
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "__bb__/search-threads",
      "__bb__/extensions",
      "__bb__/skills",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(mocks.onNewChat).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("sidebar-navigation-customize-inline"),
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("replaces the desktop rows with an inline card until Done", async () => {
    renderNavigation();

    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      document.querySelector('[data-sidebar-navigation-customize-mode="true"]'),
    ).not.toBeNull();
    expect(
      screen.getByTestId("sidebar-navigation-customize-inline"),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "More sidebar navigation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Back to sidebar" }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        document.activeElement?.getAttribute(
          "data-sidebar-navigation-customize-launch",
        ),
      ).toBe("__bb__/new-thread"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.queryByRole("list", { name: "Sidebar navigation" }),
    ).toBeNull();
    expect(visibleRowKeys()).toEqual(DEFAULT_VISIBLE_HOST_KEYS);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "New thread" }),
    );
  });

  it("focuses the More popover itself instead of its first row on open", async () => {
    renderNavigation();

    await openMoreMenu();

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("dialog", { name: "More sidebar navigation" }),
      ),
    );
  });

  it("returns focus to More after Done when Customize was opened from More", async () => {
    renderNavigation();

    await openMoreMenu();
    await openCustomizeFromMore();
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));

    expect(moreTrigger()).toBe(document.activeElement);
  });

  it("closes the inline card on Escape", async () => {
    renderNavigation();

    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    fireEvent.keyDown(
      screen.getByTestId("sidebar-navigation-customize-inline"),
      { key: "Escape" },
    );

    expect(
      screen.queryByRole("list", { name: "Sidebar navigation" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).not.toBeNull();
  });

  it("hides a built-in row from its context menu", async () => {
    const { store } = renderNavigation({
      storedOrder: HOST_KEYS,
      storedVisibleKeys: HOST_KEYS,
    });

    expect(screen.queryByTestId("sidebar-navigation-more-row")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "__bb__/new-thread",
      "__bb__/search-threads",
      "__bb__/skills",
    ]);
    expect(visibleRowKeys()).toEqual([
      "__bb__/new-thread",
      "__bb__/search-threads",
      "__bb__/skills",
    ]);
    expect(screen.getByTestId("sidebar-navigation-more-row")).not.toBeNull();
  });

  it("hides a crashed accessory and retries it after a plugin reload", () => {
    function CrashingAccessory(): never {
      throw new Error("accessory crashed");
    }
    registerPanel("tasks", "Tasks", CrashingAccessory);

    const view = renderNavigation();

    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
    expect(screen.getByRole("button", { name: "Tasks" })).not.toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).not.toBeNull();

    resetCrashedPluginSlots("tasks");
    act(() => registerPanel("tasks", "Tasks", () => <span>18</span>));

    expect(screen.getByText("18")).toBeDefined();
    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
  });

  it("shows every plugin directly by default", async () => {
    const labels = ["One", "Two", "Three", "Four", "Five", "Six"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));

    renderNavigation();

    expect(panelRowNames(labels)).toEqual(labels);
    expect(visibleRowKeys()).toEqual([
      ...DEFAULT_VISIBLE_HOST_KEYS,
      ...labels.map((_, index) => `plugin-${index}/main`),
    ]);
    expect(await openMoreMenu()).toEqual([
      "Search threads",
      "Customize sidebar",
    ]);
  });

  it("hides only Search by default and offers it under More", async () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderNavigation({
      storedOrder: [
        "plugin-0/main",
        "__bb__/new-thread",
        "plugin-1/main",
        "__bb__/search-threads",
        "plugin-2/main",
        "__bb__/extensions",
        "__bb__/skills",
        "plugin-3/main",
      ],
    });

    expect(visibleRowKeys()).toEqual([
      "plugin-0/main",
      "__bb__/new-thread",
      "plugin-1/main",
      "plugin-2/main",
      "__bb__/extensions",
      "__bb__/skills",
      "plugin-3/main",
    ]);
    expect(navigationRoot()?.lastElementChild).toBe(
      screen.getByTestId("sidebar-navigation-more-row"),
    );

    const trigger = moreTrigger();
    for (const token of [
      "text-subtle-foreground",
      "hover:text-sidebar-foreground",
      "focus-visible:text-sidebar-foreground",
      "data-[state=open]:text-sidebar-foreground",
    ]) {
      expect(trigger.classList.contains(token)).toBe(true);
    }
    expect(trigger.getAttribute("data-state")).toBe("closed");

    const items = await openMoreMenu();
    expect(trigger.getAttribute("data-state")).toBe("open");
    expect(items).toEqual(["Search threads", "Customize sidebar"]);
    expect(
      screen
        .getByRole("button", { name: "Customize sidebar" })
        .querySelectorAll(
          ':scope > [data-icon="FilterHorizontal"][data-icon-root]',
        ),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));

    expect(mocks.onSearchThreads).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("thread.search", null);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger.getAttribute("data-state")).toBe("closed");
  });

  it("opens a hidden plugin in a split on modifier-click from More", async () => {
    registerPanel("docs", "Docs");
    const { store } = renderNavigation({
      splitEnabled: true,
      storedOrder: [...HOST_KEYS, "docs/main"],
      storedVisibleKeys: [],
    });

    await openMoreMenu();
    fireEvent.click(screen.getByRole("button", { name: "Docs" }), {
      metaKey: true,
    });

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
  });

  it("opens a hidden plugin in a split from its explicit actions button", async () => {
    registerPanel("docs", "Docs");
    const { store } = renderNavigation({
      splitEnabled: true,
      storedOrder: [...HOST_KEYS, "docs/main"],
      storedVisibleKeys: [],
    });

    await openMoreMenu();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs options" }),
      { button: 0 },
    );
    const menu = await screen.findByRole("menu", { name: "Docs options" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open in split", "Add to sidebar"]);
    expect(
      screen.queryByRole("menu", { name: "More sidebar navigation options" }),
    ).toBeNull();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Open in split" }),
    );

    const layout = store.get(splitLayoutAtom)!;
    expect(countPanes(layout.root)).toBe(2);
    expect(
      findPaneByContent(layout.root, {
        kind: "plugin-panel",
        pluginId: "docs",
        panelPath: "main",
        subPath: "",
      }),
    ).not.toBeNull();
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([]);
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "More navigation" }),
      ).toBeNull(),
    );
  });

  it.each([
    { direction: "left", x: 300, y: 115 },
    { direction: "down", x: 600, y: 580 },
  ])(
    "drags a portaled overflow row directly $direction into a split",
    async ({ x, y }) => {
      registerPanel("docs", "Docs");
      const { store } = renderNavigation({
        splitEnabled: true,
        storedOrder: [...HOST_KEYS, "docs/main"],
        storedVisibleKeys: [],
      });
      const pane = document.createElement("main");
      pane.setAttribute("data-split-pane-id", "pane-1");
      document.body.append(pane);
      vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(
        new DOMRect(256, 0, 900, 600),
      );
      const elementsFromPoint = Object.getOwnPropertyDescriptor(
        document,
        "elementsFromPoint",
      );
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: () => [pane],
      });

      try {
        await openMoreMenu();
        const row = screen.getByRole("button", { name: "Docs" });
        vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
          new DOMRect(400, 100, 240, 32),
        );
        expect(row.closest('[data-sidebar="sidebar"]')).toBeNull();
        fireEvent(
          row,
          new MouseEvent("pointerdown", {
            button: 0,
            clientX: 600,
            clientY: 115,
            bubbles: true,
          }),
        );
        fireEvent(
          window,
          new MouseEvent("pointermove", { clientX: 602, clientY: 117 }),
        );
        expect(
          screen.getByRole("list", { name: "More navigation" }),
        ).not.toBeNull();
        fireEvent(
          window,
          new MouseEvent("pointermove", { clientX: x, clientY: y }),
        );
        await waitFor(() =>
          expect(
            screen.queryByRole("list", { name: "More navigation" }),
          ).toBeNull(),
        );
        expect(screen.getByTestId("location-path").textContent).toBe("/");
        fireEvent(
          window,
          new MouseEvent("pointerup", { clientX: x, clientY: y }),
        );

        const layout = store.get(splitLayoutAtom)!;
        expect(countPanes(layout.root)).toBe(2);
        expect(
          findPaneByContent(layout.root, { kind: "new-thread" }),
        ).not.toBeNull();
        expect(
          findPaneByContent(layout.root, {
            kind: "plugin-panel",
            pluginId: "docs",
            panelPath: "main",
            subPath: "",
          }),
        ).not.toBeNull();
      } finally {
        fireEvent(window, new MouseEvent("pointercancel"));
        fireEvent.click(window);
        if (elementsFromPoint) {
          Object.defineProperty(
            document,
            "elementsFromPoint",
            elementsFromPoint,
          );
        } else {
          Reflect.deleteProperty(document, "elementsFromPoint");
        }
        pane.remove();
      }
    },
  );

  it.each(["plugin", "built-in"])(
    "adds a hidden %s row to the sidebar without navigating",
    async (kind) => {
      registerPanel("docs", "Docs");
      const { store } = renderNavigation({
        storedOrder: ["docs/main", ...HOST_KEYS],
        storedVisibleKeys: [],
      });
      const title = kind === "plugin" ? "Docs" : "Search threads";
      const key = kind === "plugin" ? "docs/main" : "__bb__/search-threads";

      await openMoreMenu();
      fireEvent.pointerDown(
        screen.getByRole("button", { name: `${title} options` }),
        { button: 0 },
      );
      const menu = await screen.findByRole("menu", {
        name: `${title} options`,
      });
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "Add to sidebar" }),
      );

      expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([key]);
      expect(visibleRowKeys()).toEqual([key]);
      expect(mocks.onSearchThreads).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expect(screen.getByTestId("location-path").textContent).toBe("/");
      await waitFor(() =>
        expect(
          screen.queryByRole("list", { name: "More navigation" }),
        ).toBeNull(),
      );
    },
  );

  it("keeps launch and visibility as distinct targets with a clear row hover state", async () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    const { store, unmount } = renderNavigation();

    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    const choices = screen.getAllByRole("checkbox");
    await waitFor(() =>
      expect(
        document.activeElement?.getAttribute(
          "data-sidebar-navigation-customize-launch",
        ),
      ).toBe("__bb__/new-thread"),
    );
    expect(choices.map((choice) => choice.getAttribute("data-state"))).toEqual([
      "checked",
      "unchecked",
      "checked",
      "checked",
      "checked",
      "checked",
      "checked",
      "checked",
    ]);
    expect(
      document.querySelectorAll("[data-plugin-nav-customize-drag-handle]"),
    ).toHaveLength(8);
    expect(
      customizeRows()[0]?.classList.contains("hover:bg-sidebar-accent"),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show One in sidebar" }),
    );
    expect(
      screen.getByRole("list", { name: "Sidebar navigation" }),
    ).not.toBeNull();
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      ...DEFAULT_VISIBLE_HOST_KEYS,
      "plugin-1/main",
      "plugin-2/main",
      "plugin-3/main",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(panelRowNames(labels)).toEqual(["Two", "Three", "Four"]);
    expect(screen.getByTestId("sidebar-navigation-more-row")).not.toBeNull();

    unmount();
    renderNavigation({
      storedOrder: store.get(pluginNavPanelOrderAtom),
      storedVisibleKeys: store.get(pluginNavVisiblePanelKeysAtom),
    });
    expect(panelRowNames(labels)).toEqual(["Two", "Three", "Four"]);
    expect(screen.queryByRole("button", { name: "One" })).toBeNull();

    const items = await openMoreMenu();
    expect(items).toEqual(["Search threads", "One", "Customize sidebar"]);
    fireEvent.click(screen.getByRole("button", { name: "One" }));

    expect(screen.getByTestId("location-path").textContent).toBe(
      getPluginPanelRoutePath({ pluginId: "plugin-0", path: "main" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "More navigation" }),
      ).toBeNull(),
    );
    expect(panelRowNames(labels)).toEqual(["Two", "Three", "Four"]);
  });

  it.each(["sidebar", "desktop customize", "compact customize"] as const)(
    "persists new rows and existing hidden choices when reordered through %s",
    async (mode) => {
      registerPanel("docs", "Docs");
      registerPanel("github", "GitHub");
      registerPanel("tasks", "Tasks");
      const view = renderNavigation({
        compactViewport: mode === "compact customize",
        storedOrder: [
          "__bb__/extensions",
          "docs/main",
          "github/main",
          "unregistered/main",
        ],
        storedVisibleKeys: [
          "__bb__/extensions",
          "docs/main",
          "unregistered/main",
        ],
      });
      const initialVisibleKeys = visibleRowKeys();
      expect(initialVisibleKeys).toEqual([
        "__bb__/new-thread",
        "__bb__/extensions",
        "__bb__/skills",
        "docs/main",
        "tasks/main",
      ]);
      if (mode !== "sidebar") {
        await openCustomizeFromContextMenu(
          screen.getByRole("button", { name: "New thread" }),
        );
      }
      reorderSidebar(
        "tasks/main",
        "docs/main",
        mode === "sidebar" ? "sidebar" : "customize",
      );
      const storedOrder = view.store.get(pluginNavPanelOrderAtom);
      const storedVisibleKeys = view.store.get(pluginNavVisiblePanelKeysAtom);
      expect(new Set(storedVisibleKeys)).toEqual(
        new Set([...initialVisibleKeys, "unregistered/main"]),
      );
      expect(storedOrder).toContain("unregistered/main");
      expect(storedOrder.indexOf("tasks/main")).toBeLessThan(
        storedOrder.indexOf("docs/main"),
      );
      view.unmount();
      renderNavigation({ storedOrder, storedVisibleKeys });
      expect(visibleRowKeys()).toEqual([
        "__bb__/new-thread",
        "__bb__/extensions",
        "__bb__/skills",
        "tasks/main",
        "docs/main",
      ]);
    },
  );

  it("keeps Skills hidden when inherited from a hidden Plugins row after reordering", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderNavigation({
      storedOrder: [
        "__bb__/new-thread",
        "__bb__/search-threads",
        "__bb__/extensions",
        "docs/main",
      ],
      storedVisibleKeys: ["docs/main"],
    });
    reorderSidebar("tasks/main", "docs/main");
    expect(visibleRowKeys()).toEqual(["tasks/main", "docs/main"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "tasks/main",
      "docs/main",
    ]);
  });

  it("preserves default visibility when reordering the sidebar without saved choices", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderNavigation({ storedVisibleKeys: null });
    reorderSidebar("tasks/main", "docs/main");
    expect(visibleRowKeys()).toEqual([
      ...DEFAULT_VISIBLE_HOST_KEYS,
      "tasks/main",
      "docs/main",
    ]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toBeNull();
  });

  it("seeds newly introduced built-ins without overriding existing plugin visibility", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderNavigation({
      storedOrder: ["tasks/main", "docs/main"],
      storedVisibleKeys: ["docs/main"],
    });

    expect(visibleRowKeys()).toEqual([
      ...DEFAULT_VISIBLE_HOST_KEYS,
      "docs/main",
    ]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual(["docs/main"]);
    expect(store.get(pluginNavPanelOrderAtom)).toEqual([
      "tasks/main",
      "docs/main",
    ]);
  });

  it("shows a newly installed plugin without touching existing choices", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderNavigation({
      storedOrder: [...HOST_KEYS, "docs/main"],
      storedVisibleKeys: ["__bb__/new-thread"],
    });

    expect(visibleRowKeys()).toEqual(["__bb__/new-thread", "tasks/main"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "__bb__/new-thread",
    ]);
    expect(store.get(pluginNavPanelOrderAtom)).toEqual([
      ...HOST_KEYS,
      "docs/main",
    ]);
  });

  it("respects a stored choice to keep Search visible", () => {
    renderNavigation({
      storedOrder: HOST_KEYS,
      storedVisibleKeys: HOST_KEYS,
    });

    expect(visibleRowKeys()).toEqual(HOST_KEYS);
    expect(screen.queryByTestId("sidebar-navigation-more-row")).toBeNull();
  });

  it("shows More only while something is hidden", async () => {
    renderNavigation({
      storedOrder: HOST_KEYS,
      storedVisibleKeys: HOST_KEYS,
    });

    expect(screen.queryByTestId("sidebar-navigation-more-row")).toBeNull();
    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show New thread in sidebar" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(visibleRowKeys()).toEqual(HOST_KEYS.slice(1));
    expect(screen.getByTestId("sidebar-navigation-more-row")).not.toBeNull();

    await openMoreMenu();
    await openCustomizeFromMore();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show New thread in sidebar" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(visibleRowKeys()).toEqual(HOST_KEYS);
    expect(screen.queryByTestId("sidebar-navigation-more-row")).toBeNull();
  });

  it("applies one persisted mixed order to direct rows and the menu", async () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderNavigation({
      storedOrder: [
        "plugin-3/main",
        "__bb__/search-threads",
        "plugin-1/main",
        "__bb__/new-thread",
        "plugin-0/main",
        "plugin-2/main",
        "__bb__/extensions",
        "__bb__/skills",
      ],
      storedVisibleKeys: [
        "plugin-3/main",
        "__bb__/search-threads",
        "__bb__/new-thread",
        "plugin-0/main",
      ],
    });

    expect(visibleRowKeys()).toEqual([
      "plugin-3/main",
      "__bb__/search-threads",
      "__bb__/new-thread",
      "plugin-0/main",
    ]);

    const items = await openMoreMenu();
    expect(items).toEqual([
      "Two",
      "Three",
      "Plugins",
      "Skills",
      "Customize sidebar",
    ]);
    await openCustomizeFromMore();
    expect(customizeRows().map((row) => row.textContent?.trim())).toEqual([
      "Four",
      "Search threads",
      "Two",
      "New thread",
      "One",
      "Three",
      "Plugins",
      "Skills",
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
      "unchecked",
      "unchecked",
    ]);
  });

  it("launches a built-in row from the menu without changing its visibility", async () => {
    const { store } = renderNavigation();

    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    const row = customizeRows()[0];
    expect(row).toBeDefined();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "New thread" }),
    );

    expect(mocks.onNewChat).toHaveBeenCalledTimes(1);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Sidebar navigation" }),
      ).toBeNull(),
    );
    expect(visibleRowKeys()).toEqual(DEFAULT_VISIBLE_HOST_KEYS);
  });

  it("preserves modifier-click when launching a built-in from Customize", async () => {
    const { store } = renderNavigation({
      splitEnabled: true,
      initialLayout: {
        root: {
          type: "pane",
          paneId: "pane-1",
          content: { kind: "thread", projectId: "proj_1", threadId: "thr_1" },
        },
        focusedPaneId: "pane-1",
      },
    });

    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    const row = customizeRows()[0];
    expect(row).toBeDefined();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "New thread" }),
      { metaKey: true },
    );

    expect(mocks.onNewChat).not.toHaveBeenCalled();
    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(2);
    expect(
      findPaneByContent(layout!.root, { kind: "new-thread" }),
    ).not.toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Sidebar navigation" }),
      ).toBeNull(),
    );
  });

  it("preserves modifier-click when launching a plugin from Customize", async () => {
    registerPanel("docs", "Docs");
    const { store } = renderNavigation({ splitEnabled: true });

    await openCustomizeFromContextMenu(
      screen.getByRole("button", { name: "New thread" }),
    );
    const row = customizeRows().find((item) =>
      item.textContent?.includes("Docs"),
    );
    if (!row) throw new Error("Docs customization row is missing");
    fireEvent.click(within(row).getByRole("button", { name: "Docs" }), {
      metaKey: true,
    });

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
    const view = renderNavigation({ splitEnabled: true });

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
