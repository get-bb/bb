// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
import type {
  ExperimentalSidebarNavigationProps,
  PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import {
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { getPluginPanelRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  MAX_PANES,
  countPanes,
  findPaneByContent,
  type SplitLayout,
} from "@/lib/split-layout";
import { registerNavigationPlugin } from "@/test/fixtures/navigation-plugin";
import {
  SidebarNavigationProviderMount,
  SidebarNavigationRegion,
  useSidebarNavigationCustomize,
} from "./SidebarNavigationHost";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";
import {
  sidebarNavigationPlacement,
  sidebarNavigationProviderAtom,
  useResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: () => {},
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: mocks.toastError, success: () => {} },
}));

const useNavigation =
  pluginSdkAppImplementation.experimental_useSidebarNavigation;
const THREAD_PATH = getThreadRoutePath({
  projectId: "proj_one",
  threadId: "thr_one",
});

function PluginNavigation({ placement }: ExperimentalSidebarNavigationProps) {
  const { items, actions } = useNavigation();
  return (
    <div data-testid="plugin-navigation" data-placement={placement}>
      {items
        .filter((item) => item.isVisible)
        .map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => actions.activate(item.id, { target: "current" })}
          >
            {item.badge ? `${item.label} (${item.badge.label})` : item.label}
          </button>
        ))}
      <button type="button" onClick={() => actions.openCustomize()}>
        Arrange
      </button>
    </div>
  );
}

function registerPlugin(setup: (app: PluginAppBuilder) => void) {
  act(() =>
    setPluginSlotRegistrations(
      "compact",
      collectPluginAppRegistrations({ __bbPluginApp: true, setup }),
    ),
  );
}

function registerDocsPanel() {
  setPluginSlotRegistrations(
    "garden",
    collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.navPanel({
          id: "docs",
          title: "Docs",
          icon: "BookOpen",
          path: "docs",
          component: () => null,
          experimental_useBadge: () => ({ count: 2, label: "2 drafts" }),
        });
      },
    }),
  );
}

function Harness({ splitEnabled = false }: { splitEnabled?: boolean }) {
  const location = useLocation();
  const resolved = useResolvedSidebarNavigation();
  const customize = useSidebarNavigationCustomize();
  return (
    <SidebarNavigationModelProvider
      onOpenCustomize={customize.open}
      splitEnabled={splitEnabled}
    >
      <SidebarNavigationRegion
        placement={sidebarNavigationPlacement(resolved)}
        customize={customize}
      >
        <SidebarNavigationProviderMount resolved={resolved} />
      </SidebarNavigationRegion>
      <output data-testid="pathname">{location.pathname}</output>
    </SidebarNavigationModelProvider>
  );
}

function renderHost(
  preference = "__automatic__",
  options: {
    splitEnabled?: boolean;
    compact?: boolean;
    store?: ReturnType<typeof createStore>;
  } = {},
) {
  const store = options.store ?? createStore();
  store.set(sidebarNavigationProviderAtom, preference);
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[THREAD_PATH]}>
        <CompactViewportOverrideProvider
          isCompactViewport={options.compact ?? false}
        >
          <TooltipProvider>
            <SidebarProvider>
              <Harness splitEnabled={options.splitEnabled} />
            </SidebarProvider>
          </TooltipProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function region(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    "[data-sidebar-navigation-placement]",
  );
  if (element === null) throw new Error("Expected the navigation region");
  return element;
}

beforeAll(async () => {
  await SidebarVisibilityCustomize.preload();
});

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  registerDocsPanel();
  await registerNavigationPlugin();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
});

describe("sidebar navigation providers", () => {
  describe.each(["navigation/rail", "navigation/top-list"])(
    "%s destination activation",
    (layout) => {
      it.each([
        ["Plugins", "/plugins", { metaKey: true }],
        ["Plugins", "/plugins", { ctrlKey: true }],
        ["Skills", "/skills", { metaKey: true }],
        ["Skills", "/skills", { ctrlKey: true }],
      ])("opens %s (%s) in a browser tab with %j", (label, path, modifier) => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        renderHost(layout);

        fireEvent.click(screen.getByRole("button", { name: label }), modifier);

        expect(open).toHaveBeenCalledExactlyOnceWith(
          path,
          "_blank",
          "noopener,noreferrer",
        );
        expect(screen.getByTestId("pathname").textContent).toBe(THREAD_PATH);
      });

      it("opens a plugin panel in a browser tab with a modifier when it cannot split", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        renderHost(layout);

        fireEvent.click(
          screen.getByRole("button", { name: "Docs, 2 drafts" }),
          {
            metaKey: true,
          },
        );

        expect(open).toHaveBeenCalledExactlyOnceWith(
          getPluginPanelRoutePath({ pluginId: "garden", path: "docs" }),
          "_blank",
          "noopener,noreferrer",
        );
        expect(screen.getByTestId("pathname").textContent).toBe(THREAD_PATH);
      });

      it.each([
        ["Plugins", "/plugins"],
        ["Skills", "/skills"],
      ])("opens %s in place without a modifier", (label, path) => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        renderHost(layout);

        fireEvent.click(screen.getByRole("button", { name: label }));

        expect(open).not.toHaveBeenCalled();
        expect(screen.getByTestId("pathname").textContent).toBe(path);
      });
    },
  );

  it.each([
    ["Plugins", "/plugins", true],
    ["Skills", "/skills", true],
    ["Plugins", "/plugins", false],
    [
      "Docs",
      getPluginPanelRoutePath({ pluginId: "garden", path: "docs" }),
      true,
    ],
  ])(
    "preserves legacy activation for %s at %s with openInSplit=%s",
    (label, path, openInSplit) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      function LegacyNavigation() {
        const { items, actions } = useNavigation();
        return items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              // @ts-expect-error Legacy bundles still send the removed activation field.
              actions.activate(item.id, { openInSplit });
            }}
          >
            {item.label}
          </button>
        ));
      }
      registerPlugin((app) =>
        app.slots.experimental_sidebarNavigation({
          id: "legacy",
          title: "Legacy navigation",
          component: LegacyNavigation,
        }),
      );
      renderHost();

      fireEvent.click(screen.getByRole("button", { name: label }));

      if (openInSplit) {
        expect(open).toHaveBeenCalledExactlyOnceWith(
          path,
          "_blank",
          "noopener,noreferrer",
        );
        expect(screen.getByTestId("pathname").textContent).toBe(THREAD_PATH);
      } else {
        expect(open).not.toHaveBeenCalled();
        expect(screen.getByTestId("pathname").textContent).toBe(path);
      }
    },
  );

  describe.each(["explicit", "legacy"])("%s split requests", (api) => {
    it.each([
      {
        reason: "disabled",
        enabled: false,
        compact: false,
        panes: 1,
        label: "Docs",
        result: "tab",
      },
      {
        reason: "compact",
        enabled: true,
        compact: true,
        panes: 1,
        label: "Docs",
        result: "tab",
      },
      {
        reason: "missing layout",
        enabled: true,
        compact: false,
        panes: 0,
        label: "Docs",
        result: "tab",
      },
      {
        reason: "pane limit",
        enabled: true,
        compact: false,
        panes: MAX_PANES,
        label: "Docs",
        result: "replace",
      },
      {
        reason: "unsupported destination",
        enabled: true,
        compact: false,
        panes: 1,
        label: "Plugins",
        result: "tab",
      },
      {
        reason: "available",
        enabled: true,
        compact: false,
        panes: 1,
        label: "Docs",
        result: "split",
      },
      {
        reason: "already open at limit",
        enabled: true,
        compact: false,
        panes: MAX_PANES,
        label: "Docs",
        result: "focus",
      },
    ])("handles $reason", ({ enabled, compact, panes, label, result }) => {
      const store = createStore();
      const docs = {
        kind: "plugin-panel" as const,
        pluginId: "garden",
        panelPath: "docs",
        subPath: "",
      };
      const children = Array.from({ length: panes }, (_, i) => ({
        type: "pane" as const,
        paneId: `pane-${i}`,
        content:
          result === "focus" && i === 1
            ? docs
            : {
                kind: "thread" as const,
                projectId: "proj_one",
                threadId: `thr_${i}`,
              },
      }));
      const layout: SplitLayout | null =
        panes === 0
          ? null
          : {
              focusedPaneId: "pane-0",
              root:
                children.length === 1
                  ? children[0]!
                  : {
                      type: "split",
                      dir: "row",
                      sizes: children.map(() => 1 / panes),
                      children,
                    },
            };
      store.set(splitLayoutAtom, layout);
      function SplitNavigation() {
        const { items, actions } = useNavigation();
        return items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (api === "explicit")
                actions.activate(item.id, { target: "split" });
              else {
                // @ts-expect-error Legacy bundles still send the removed activation field.
                actions.activate(item.id, { openInSplit: true });
              }
            }}
          >
            {item.label}
          </button>
        ));
      }
      registerPlugin((app) =>
        app.slots.experimental_sidebarNavigation({
          id: "split",
          title: "Split navigation",
          component: SplitNavigation,
        }),
      );
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderHost("__automatic__", { store, splitEnabled: enabled, compact });
      fireEvent.click(screen.getByRole("button", { name: label }));
      const path =
        label === "Plugins"
          ? "/plugins"
          : getPluginPanelRoutePath({ pluginId: "garden", path: "docs" });
      if (result === "tab") {
        expect(open).toHaveBeenCalledExactlyOnceWith(
          path,
          "_blank",
          "noopener,noreferrer",
        );
        expect(store.get(splitLayoutAtom)).toEqual(layout);
        expect(screen.getByTestId("pathname").textContent).toBe(THREAD_PATH);
      } else {
        expect(open).not.toHaveBeenCalled();
        const next = store.get(splitLayoutAtom)!;
        expect(countPanes(next.root)).toBe(result === "split" ? 2 : panes);
        expect(findPaneByContent(next.root, docs)?.paneId).toBe(
          next.focusedPaneId,
        );
        if (result === "replace") expect(next.focusedPaneId).toBe("pane-0");
        if (result === "focus") {
          expect(next.root).toEqual(layout?.root);
          expect(next.focusedPaneId).toBe("pane-1");
        }
        expect(screen.getByTestId("pathname").textContent).toBe(path);
      }
    });
  });

  it("draws the bundled Rail when no other plugin provides navigation", () => {
    renderHost();

    expect(region().dataset.sidebarNavigationPlacement).toBe("rail");
    expect(screen.getByTestId("app-nav-rail")).toBeDefined();
  });

  it("lets an installed plugin draw the navigation above the thread list from the shared model", () => {
    registerPlugin((app) =>
      app.slots.experimental_sidebarNavigation({
        id: "nav",
        title: "Compact nav",
        component: PluginNavigation,
      }),
    );
    renderHost();

    expect(region().dataset.sidebarNavigationPlacement).toBe("list");
    expect(screen.getByTestId("plugin-navigation").dataset.placement).toBe(
      "list",
    );
    expect(screen.queryByTestId("app-nav-rail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Docs (2 drafts)" }));
    expect(screen.getByTestId("pathname").textContent).toBe(
      getPluginPanelRoutePath({ pluginId: "garden", path: "docs" }),
    );
  });

  it("keeps a pinned bundled layout over an installed plugin provider", () => {
    registerPlugin((app) =>
      app.slots.experimental_sidebarNavigation({
        id: "nav",
        title: "Compact nav",
        component: PluginNavigation,
      }),
    );
    renderHost("navigation/top-list");

    expect(screen.queryByTestId("plugin-navigation")).toBeNull();
    expect(screen.getByTestId("sidebar-navigation-list")).toBeDefined();
  });

  it("opens bb's customize editor beside a plugin's navigation", async () => {
    registerPlugin((app) =>
      app.slots.experimental_sidebarNavigation({
        id: "nav",
        title: "Compact nav",
        placement: "rail",
        component: PluginNavigation,
      }),
    );
    renderHost();

    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));

    expect(await screen.findByTestId("nav-rail-customize")).toBeDefined();
  });

  it("replaces a crashing plugin provider with the bundled provider for the same placement", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerPlugin((app) =>
      app.slots.experimental_sidebarNavigation({
        id: "nav",
        title: "Broken rail",
        placement: "rail",
        component: () => {
          throw new Error("boom");
        },
      }),
    );
    renderHost();

    expect(region().dataset.sidebarNavigationPlacement).toBe("rail");
    expect(screen.getByTestId("app-nav-rail")).toBeDefined();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Sidebar navigation plugin crashed",
      {
        description:
          "Broken rail (compact) stopped working, so bb drew Rail instead.",
      },
    );
  });

  it("says so in the list placement when no navigation plugin is enabled", () => {
    removePluginSlotRegistrations("navigation");
    renderHost();

    expect(region().dataset.sidebarNavigationPlacement).toBe("list");
    expect(
      region().querySelector('[data-sidebar-navigation-placeholder="missing"]')
        ?.textContent,
    ).toBe("No navigation plugin is enabled.");
  });

  it("renders the bundled provider for the placement as a plugin's Original", () => {
    registerPlugin((app) =>
      app.slots.experimental_sidebarNavigation({
        id: "nav",
        title: "Wrapper",
        component: ({ experimental_Original: Original }) => (
          <section data-testid="wrapper">
            <Original />
          </section>
        ),
      }),
    );
    renderHost();

    expect(
      screen
        .getByTestId("wrapper")
        .querySelector('[data-testid="sidebar-navigation-list"]'),
    ).not.toBeNull();
  });
});
