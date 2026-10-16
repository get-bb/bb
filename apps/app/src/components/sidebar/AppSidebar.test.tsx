// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { registerNavigationPlugin } from "@/test/fixtures/navigation-plugin";
import { AppSidebar } from "./AppSidebar";
import {
  sidebarNavigationProviderAtom,
  useResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => {},
  useAppCommandRunner: () => ({
    dispatch: () => {},
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => [],
  useIndexedAppCommandHandlers: () => {},
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("./PluginThreadList", () => ({
  PluginThreadList: () => <div data-testid="thread-list" />,
}));

vi.mock("@/components/plugin/PluginSidebarFooterItems", () => ({
  PluginSidebarFooterDisclosure: () => null,
  PluginSidebarFooterItems: ({
    builtInActions,
  }: {
    builtInActions: readonly { id: string }[];
  }) => (
    <>
      {builtInActions.map((action) => (
        <button key={action.id} type="button">
          {action.id}
        </button>
      ))}
    </>
  ),
  usePluginSidebarFooterDisclosure: () => ({
    activeItem: null,
    activeKey: null,
    dismiss: () => {},
    handleCommand: () => {},
  }),
}));

vi.mock("./SidebarPluginAttentionGlyph", () => ({
  SidebarPluginAttentionGlyph: () => null,
}));

vi.mock("./SidebarUpdatesBadge", () => ({
  SidebarUpdatesBadge: () => null,
}));

function Harness() {
  const navigation = useResolvedSidebarNavigation();
  return (
    <AppSidebar
      onResizeMouseDown={() => {}}
      isResizing={false}
      isBodyHidden={false}
      navigation={navigation}
      settingsRoutePath="/settings"
      isSettingsActive={false}
      alternateBody={null}
    />
  );
}

function renderSidebar(preference: string, framed = false) {
  const store = createStore();
  store.set(sidebarNavigationProviderAtom, preference);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <TooltipProvider>
            <SidebarProvider framed={framed}>
              <Harness />
            </SidebarProvider>
          </TooltipProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function navigationRegion(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    "nav[data-sidebar-navigation-placement]",
  );
  if (element === null) throw new Error("Expected the navigation region");
  return element;
}

function footer(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    '[data-sidebar="footer"]',
  );
  if (element === null) throw new Error("Expected the sidebar footer");
  return element;
}

function followingSiblings(element: Element): Element[] {
  const siblings: Element[] = [];
  for (
    let sibling = element.nextElementSibling;
    sibling !== null;
    sibling = sibling.nextElementSibling
  ) {
    siblings.push(sibling);
  }
  return siblings;
}

beforeEach(async () => {
  window.localStorage.clear();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  await registerNavigationPlugin();
});

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
});

describe("AppSidebar", () => {
  it("uses only the small top inset when framed navigation has no header controls", () => {
    renderSidebar("navigation/top-list", true);

    expect(
      screen
        .getByTestId("app-sidebar-top-reserve-row")
        .classList.contains("h-2"),
    ).toBe(true);
    expect(screen.queryByTestId("sidebar-header-slot")).toBeNull();
  });

  it("keeps the footer after the navigation in one column for list navigation, so docking plugins can inset it", () => {
    renderSidebar("navigation/top-list");

    const region = navigationRegion();
    expect(region.dataset.sidebarNavigationPlacement).toBe("list");
    expect(followingSiblings(region)).toContain(footer());
    expect(screen.getByRole("button", { name: "settings" })).toBeDefined();
  });
});
