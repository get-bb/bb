// @vitest-environment jsdom

import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk";
import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { SidebarNavigationRegion } from "./SidebarNavigationRegion";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));
vi.mock("@/components/plugin/PluginNavSidebarItems", () => ({
  PluginNavSidebarItems: () => <div>BB plugin destinations</div>,
}));

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

function Replacement({
  experimental_Original: Original,
  experimental_activate,
  items,
}: ExperimentalSidebarNavigationProps) {
  const [delegate, setDelegate] = useState(false);
  const [crash, setCrash] = useState(false);
  if (crash) throw new Error("navigation fixture crash");
  if (delegate) return <Original />;
  return (
    <div data-testid="replacement-navigation">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          {...item.experimental_splitProps}
          onClick={(event) =>
            experimental_activate(item.id, {
              openInSplit: event.metaKey || event.ctrlKey,
            })
          }
        >
          {item.label}
        </button>
      ))}
      <button type="button" onClick={() => setDelegate(true)}>
        Delegate to BB
      </button>
      <button type="button" onClick={() => setCrash(true)}>
        Crash replacement
      </button>
    </div>
  );
}

function LocationProbe() {
  return <output data-testid="pathname">{useLocation().pathname}</output>;
}

function RetainedOwner({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return (
    <div data-testid="retained-owner">Retained thread list and footer</div>
  );
}

function Harness({ onOwnerMount }: { onOwnerMount: () => void }) {
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <>
      <SidebarNavigationRegion
        splitEnabled
        newThreadSplit={{ openInSplit: vi.fn() }}
        onNavigate={vi.fn()}
        onNewChat={vi.fn()}
        toolsRoutePath="/tools/plugins"
        threadSearch={{
          activeDescendantId: undefined,
          inputRef: { current: null },
          isActive: searchActive,
          onActivate: () => setSearchActive(true),
          onClose: () => {
            setSearchActive(false);
            setQuery("");
          },
          onQueryChange: setQuery,
          query,
        }}
      />
      <RetainedOwner onMount={onOwnerMount} />
      <LocationProbe />
    </>
  );
}

function CompactHarness() {
  const { closeMobileSidebar, openMobile, setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(true), [setOpenMobile]);
  return (
    <>
      <Sidebar>
        <SidebarNavigationRegion
          splitEnabled
          newThreadSplit={{ openInSplit: vi.fn() }}
          onNavigate={closeMobileSidebar}
          onNewChat={vi.fn()}
          toolsRoutePath="/tools/plugins"
        />
      </Sidebar>
      <output data-testid="drawer-state">
        {openMobile ? "open" : "closed"}
      </output>
    </>
  );
}

function renderHarness(onOwnerMount = vi.fn()) {
  const store = createStore();
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <SidebarProvider>
          <Harness onOwnerMount={onOwnerMount} />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function registerFixture() {
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
        },
      ],
      experimentalSidebarNavigations: [
        {
          id: "navbar",
          title: "Garden Navbar",
          component: Replacement,
        },
      ],
    }),
  );
}

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SidebarNavigationRegion", () => {
  it("activates host Search and keeps the host query field outside plugin ownership", () => {
    registerFixture();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    const input = screen.getByRole("combobox", { name: "Search threads" });
    expect(input.closest("[data-bb-plugin]")).toBeNull();
    fireEvent.change(input, { target: { value: "release" } });
    expect((input as HTMLInputElement).value).toBe("release");
    expect(screen.queryByTestId("replacement-navigation")).toBeNull();
  });

  it("navigates to a current plugin destination through the host", () => {
    registerFixture();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(screen.getByTestId("pathname").textContent).toBe(
      "/plugins/garden/docs",
    );
  });

  it("closes the compact drawer after plugin-destination navigation", () => {
    vi.useFakeTimers();
    registerFixture();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <Provider store={createStore()}>
          <MemoryRouter>
            <SidebarProvider>
              <CompactHarness />
            </SidebarProvider>
          </MemoryRouter>
        </Provider>
      </CompactViewportOverrideProvider>,
    );
    expect(screen.getByTestId("drawer-state").textContent).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    vi.advanceTimersByTime(220);
    expect(screen.getByTestId("drawer-state").textContent).toBe("closed");
  });

  it("delegates and crash-falls back without remounting retained owners", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerFixture();
    const ownerMount = vi.fn();
    renderHarness(ownerMount);
    expect(ownerMount).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Delegate to BB" }));
    expect(screen.getByTestId("built-in-sidebar-navigation")).toBeDefined();
    expect(ownerMount).toHaveBeenCalledOnce();

    cleanup();
    resetAllCrashedPluginSlotsForTest();
    renderHarness(ownerMount);
    fireEvent.click(screen.getByRole("button", { name: "Crash replacement" }));
    expect(screen.getByTestId("built-in-sidebar-navigation")).toBeDefined();
    expect(ownerMount).toHaveBeenCalledTimes(2);
  });
});
