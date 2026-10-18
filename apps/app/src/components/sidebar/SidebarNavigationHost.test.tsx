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
            onClick={() => actions.activate(item.id, { openInSplit: false })}
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

function Harness() {
  const location = useLocation();
  const resolved = useResolvedSidebarNavigation();
  const customize = useSidebarNavigationCustomize();
  return (
    <SidebarNavigationModelProvider
      onOpenCustomize={customize.open}
      splitEnabled={false}
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

function renderHost(preference = "__automatic__") {
  const store = createStore();
  store.set(sidebarNavigationProviderAtom, preference);
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[THREAD_PATH]}>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <TooltipProvider>
            <SidebarProvider>
              <Harness />
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
