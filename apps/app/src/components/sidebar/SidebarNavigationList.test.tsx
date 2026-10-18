// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import type { ExperimentalBadge } from "@get-bb/plugin-sdk";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "@/components/plugin/pluginNavSidebarAtoms";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { getPluginPanelRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  bundledNavigationSlot,
  registerNavigationPlugin,
} from "@/test/fixtures/navigation-plugin";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import {
  SidebarNavigationProviderMount,
  SidebarNavigationRegion,
  useSidebarNavigationCustomize,
} from "./SidebarNavigationHost";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  onNavigate: vi.fn(),
  onNewChat: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

const THREAD_PATH = getThreadRoutePath({
  projectId: "proj_one",
  threadId: "thr_one",
});
const DOCS_PATH = getPluginPanelRoutePath({ pluginId: "garden", path: "docs" });
const ALL_KEYS = [
  "__bb__/new-thread",
  "__bb__/search-threads",
  "__bb__/extensions",
  "__bb__/skills",
  "garden/docs",
];

function ListHarness({ splitEnabled }: { splitEnabled: boolean }) {
  const location = useLocation();
  const customize = useSidebarNavigationCustomize();
  return (
    <SidebarNavigationModelProvider
      onNavigate={mocks.onNavigate}
      onNewChat={mocks.onNewChat}
      onOpenCustomize={customize.open}
      splitEnabled={splitEnabled}
    >
      <SidebarNavigationRegion placement="list" customize={customize}>
        <SidebarNavigationProviderMount
          resolved={{
            kind: "plugin",
            slot: bundledNavigationSlot("top-list"),
            fallback: null,
          }}
        />
      </SidebarNavigationRegion>
      <output data-testid="pathname">{location.pathname}</output>
    </SidebarNavigationModelProvider>
  );
}

function renderList(
  initialPath: string,
  options: {
    visibleKeys?: string[];
    isCompactViewport?: boolean;
    store?: ReturnType<typeof createStore>;
    splitEnabled?: boolean;
  } = {},
) {
  const store = options.store ?? createStore();
  if (options.visibleKeys) {
    store.set(pluginNavPanelOrderAtom, ALL_KEYS);
    store.set(pluginNavVisiblePanelKeysAtom, options.visibleKeys);
  }
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CompactViewportOverrideProvider
          isCompactViewport={options.isCompactViewport ?? false}
        >
          <TooltipProvider>
            <SidebarProvider>
              <ListHarness splitEnabled={options.splitEnabled ?? false} />
            </SidebarProvider>
          </TooltipProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function list(): HTMLElement {
  return screen.getByTestId("sidebar-navigation-list");
}

function rowButtons(container: HTMLElement): HTMLElement[] {
  return within(container)
    .getAllByRole("button")
    .filter(
      (button) => !button.getAttribute("aria-label")?.endsWith(" options"),
    );
}

function rowLabels(): string[] {
  return rowButtons(list()).map((button) => button.textContent ?? "");
}

function rowBadge(itemId: string): Element | null {
  return list().querySelector(
    `[data-sidebar-navigation-item="${itemId}"] [data-nav-rail-badge]`,
  );
}

function registerDocs(useBadge?: () => ExperimentalBadge | null) {
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "BookOpen",
          path: "docs",
          component: () => null,
          ...(useBadge ? { experimental_useBadge: useBadge } : {}),
        },
      ],
    }),
  );
}

function registerDocsBadge(badge: ExperimentalBadge) {
  const subscribe = () => () => {};
  registerDocs(() => useSyncExternalStore(subscribe, () => badge));
}

beforeAll(async () => {
  await SidebarVisibilityCustomize.preload();
});

beforeEach(async () => {
  vi.clearAllMocks();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  window.localStorage.clear();
  registerDocs();
  await registerNavigationPlugin();
});

afterEach(() => {
  cleanup();
  resetPluginFrontendBootStateForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("SidebarNavigationList", () => {
  it("labels each visible destination in a row and puts hidden ones, New thread included, behind More", async () => {
    renderList(THREAD_PATH, {
      visibleKeys: ["__bb__/extensions", "garden/docs"],
    });

    expect(rowLabels()).toEqual(["Plugins", "Docs", "More"]);

    fireEvent.keyDown(within(list()).getByRole("button", { name: "More" }), {
      key: "Enter",
    });
    const menu = await screen.findByTestId("sidebar-navigation-more-menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "New thread",
      "Search threads",
      "Skills",
      "Customize navigation",
    ]);
  });

  it("scrolls the destinations, New thread among them, keeping More in view", () => {
    renderList(THREAD_PATH);

    const destinations = screen.getByTestId("sidebar-navigation-destinations");
    expect(destinations.className).toContain("overflow-y-auto");
    expect(
      rowButtons(destinations).map((button) => button.textContent),
    ).toEqual(["New thread", "Plugins", "Skills", "Docs"]);
    const more = within(list()).getByRole("button", { name: "More" });
    expect(destinations.contains(more)).toBe(false);
  });

  it("hides New thread from Customize like any other row", async () => {
    const store = createStore();
    renderList(THREAD_PATH, { store });

    fireEvent.keyDown(within(list()).getByRole("button", { name: "More" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize navigation" }),
    );
    const editor = await screen.findByTestId("sidebar-navigation-customize");
    fireEvent.click(
      within(editor).getByRole("checkbox", { name: /New thread/u }),
    );

    expect(rowLabels()).toEqual(["Plugins", "Skills", "Docs", "More"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).not.toContain(
      "__bb__/new-thread",
    );
  });

  it("marks the open plugin panel as the current page", () => {
    renderList(DOCS_PATH);

    expect(
      within(list())
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "page")
        .map((button) => button.textContent),
    ).toEqual(["Docs"]);
  });

  it("draws a plugin panel's badge at the end of its row and names it in the row's label", () => {
    registerDocsBadge({ count: 120, label: "120 open tasks" });
    renderList(THREAD_PATH);

    expect(
      within(list()).getByRole("button", { name: "Docs, 120 open tasks" }),
    ).toBeDefined();
    expect(rowBadge("garden/docs")?.textContent).toBe("99+");
  });

  it("draws a text badge in its tone at the end of the row", () => {
    registerDocsBadge({ text: "Hot 85%", tone: "critical", label: "CPU hot" });
    renderList(THREAD_PATH);

    expect(
      within(list()).getByRole("button", { name: "Docs, CPU hot" }),
    ).toBeDefined();
    const mark = rowBadge("garden/docs");
    expect(mark?.getAttribute("data-nav-rail-badge")).toBe("text");
    expect(mark?.getAttribute("data-nav-badge-tone")).toBe("critical");
    expect(mark?.textContent).toBe("Hot 85%");
  });

  it("marks More when a badged destination is hidden under it", () => {
    registerDocsBadge({ label: "Needs review" });
    renderList(THREAD_PATH, { visibleKeys: ["__bb__/extensions"] });

    const more = within(list()).getByRole("button", {
      name: "More, Docs: Needs review",
    });
    expect(more.querySelector('[data-nav-rail-badge="dot"]')).not.toBeNull();
  });

  it("customizes the list from More and returns focus to More", async () => {
    renderList(THREAD_PATH);
    const more = within(list()).getByRole("button", { name: "More" });

    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize navigation" }),
    );

    const editor = await screen.findByTestId("sidebar-navigation-customize");
    const checklist = within(editor).getByRole("list", {
      name: "Sidebar navigation",
    });
    fireEvent.click(
      within(checklist).getByRole("checkbox", { name: /Skills/u }),
    );
    expect(rowLabels()).not.toContain("Skills");

    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByTestId("sidebar-navigation-customize")).toBeNull(),
    );
    expect(document.activeElement).toBe(more);
  });

  it("hides More when nothing is hidden", () => {
    renderList(THREAD_PATH, {
      visibleKeys: ALL_KEYS,
    });

    expect(rowLabels()).not.toContain("More");
  });

  it("opens a row's options from its menu button and customizes from there", async () => {
    renderList(THREAD_PATH);

    fireEvent.keyDown(
      within(list()).getByRole("button", { name: "Docs panel options" }),
      { key: "Enter" },
    );
    const menu = await screen.findByRole("menu", {
      name: "Docs panel options",
    });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "View details",
      "Hide from sidebar",
      "Customize navigation",
      "Disable",
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Customize navigation" }),
    );

    expect(
      await screen.findByTestId("sidebar-navigation-customize"),
    ).toBeDefined();
  });

  it("shows where a plugin panel sits when it is open in a split", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-docs",
            content: {
              kind: "plugin-panel",
              pluginId: "garden",
              panelPath: "docs",
              subPath: "",
            },
          },
          {
            type: "pane",
            paneId: "pane-thread",
            content: {
              kind: "thread",
              projectId: "proj_one",
              threadId: "thr_one",
            },
          },
        ],
      },
    });
    renderList(THREAD_PATH, { store, splitEnabled: true });

    expect(
      screen.getByRole("img", { name: "Docs, open in split" }),
    ).toBeDefined();
  });
});
