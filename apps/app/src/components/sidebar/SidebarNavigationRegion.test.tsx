// @vitest-environment jsdom

import { useEffect, useState, type MouseEventHandler } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { SidebarNavigationRegion } from "./SidebarNavigationRegion";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  openNewThreadInSplit: vi.fn(),
  onSearchThreads: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));
vi.mock("@/components/plugin/PluginNavSidebarItems", () => ({
  ResourceNavSidebarItem: () => <div />,
  PluginNavSidebarItems: ({
    builtInEntries = [],
    excludedRowKeys = [],
  }: {
    builtInEntries?: Array<{
      id: string;
      pluginId: string;
      title: string;
      onActivate: MouseEventHandler<HTMLButtonElement>;
    }>;
    excludedRowKeys?: readonly string[];
  }) => {
    const [isMoreOpen, setIsMoreOpen] = useState(false);
    return (
      <div>
        {builtInEntries
          .filter(
            (entry) =>
              !excludedRowKeys.includes(`${entry.pluginId}/${entry.id}`),
          )
          .map((entry) => (
            <button key={entry.id} type="button" onClick={entry.onActivate}>
              {entry.title}
            </button>
          ))}
        <button
          type="button"
          aria-expanded={isMoreOpen}
          onClick={() => setIsMoreOpen((isOpen) => !isOpen)}
        >
          More sidebar navigation
        </button>
        {isMoreOpen ? <div role="menu">More destinations</div> : null}
      </div>
    );
  },
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitActions: () => ({
    beginDrag: vi.fn(),
    isCompact: false,
    openInSplit: vi.fn(),
  }),
}));

function Replacement({
  activeItemId,
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
          aria-current={activeItemId === item.id ? "page" : undefined}
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

function NativeSplitReplacement({
  experimental_NavigationItems: NavigationItems,
  experimental_NewThread: NewThread,
}: ExperimentalSidebarNavigationProps) {
  if (!NewThread || !NavigationItems) {
    throw new Error("native navigation subgroups unavailable");
  }
  return (
    <div data-testid="native-split-navigation">
      <NewThread />
      <NavigationItems />
    </div>
  );
}

function LocationProbe() {
  return <output data-testid="pathname">{useLocation().pathname}</output>;
}

function RetainedOwner({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return <div data-testid="retained-owner">Retained thread list</div>;
}

function Harness({ onOwnerMount }: { onOwnerMount: () => void }) {
  return (
    <>
      <SidebarNavigationRegion
        splitEnabled
        newThreadSplit={{ openInSplit: mocks.openNewThreadInSplit }}
        onNavigate={vi.fn()}
        onNewChat={vi.fn()}
        onSearchThreads={mocks.onSearchThreads}
      />
      <RetainedOwner onMount={onOwnerMount} />
      <LocationProbe />
    </>
  );
}

function RerenderingNativeSplitHarness({
  onSearchThreads,
}: {
  onSearchThreads: (revision: number) => void;
}) {
  const [revision, setRevision] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Update navigation props
      </button>
      <SidebarNavigationRegion
        splitEnabled
        newThreadSplit={{ openInSplit: mocks.openNewThreadInSplit }}
        onNavigate={vi.fn()}
        onNewChat={vi.fn()}
        onSearchThreads={() => onSearchThreads(revision)}
      />
    </>
  );
}

function renderHarness(
  onOwnerMount = vi.fn(),
  initialEntries: string[] = ["/"],
) {
  return render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={initialEntries}>
        <SidebarProvider>
          <Harness onOwnerMount={onOwnerMount} />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function renderRerenderingNativeSplitHarness(
  onSearchThreads: (revision: number) => void,
) {
  return render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <SidebarProvider>
          <RerenderingNativeSplitHarness onSearchThreads={onSearchThreads} />
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

function registerNativeSplitFixture() {
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      experimentalSidebarNavigations: [
        {
          id: "navbar",
          title: "Garden Navbar",
          component: NativeSplitReplacement,
        },
      ],
    }),
  );
}

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  resetNotificationStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
  mocks.dispatch.mockReset();
  mocks.openNewThreadInSplit.mockReset();
  mocks.onSearchThreads.mockReset();
});

describe("SidebarNavigationRegion", () => {
  it("preserves modifier-click for New thread in BB navigation", () => {
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "New thread" }), {
      metaKey: true,
    });

    expect(mocks.openNewThreadInSplit).toHaveBeenCalledOnce();
  });

  it("routes Search through the quick palette without inline search UI", () => {
    registerFixture();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));

    expect(mocks.onSearchThreads).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("thread.search", null);
    expect(
      screen.queryByRole("combobox", { name: "Search threads" }),
    ).toBeNull();
    expect(screen.getByTestId("replacement-navigation")).toBeDefined();
  });

  it("provides native New thread separately from the remaining navigation", () => {
    registerNativeSplitFixture();
    renderHarness();

    expect(screen.getByTestId("native-split-navigation")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "New thread" })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Search threads" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Plugins" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Skills" })).toBeDefined();
  });

  it("keeps the native More menu mounted while host props update", () => {
    registerNativeSplitFixture();
    const onSearchThreads = vi.fn();
    renderRerenderingNativeSplitHarness(onSearchThreads);

    const more = screen.getByRole("button", {
      name: "More sidebar navigation",
    });
    fireEvent.click(more);
    more.focus();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu").textContent).toBe("More destinations");

    fireEvent.click(
      screen.getByRole("button", { name: "Update navigation props" }),
    );
    expect(
      screen.getByRole("button", { name: "More sidebar navigation" }),
    ).toBe(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(more);

    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    expect(onSearchThreads).toHaveBeenCalledWith(1);
  });

  it("navigates to a current plugin destination through the host", () => {
    registerFixture();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/plugins/garden/docs",
    );
  });

  it("routes Plugins and Skills while preserving the active resource row", () => {
    registerFixture();
    renderHarness(vi.fn(), ["/skills/library/demo"]);

    expect(
      screen
        .getByRole("button", { name: "Skills" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("button", { name: "Plugins" })
        .getAttribute("aria-current"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByTestId("pathname").textContent).toBe("/plugins");
    expect(
      screen
        .getByRole("button", { name: "Plugins" })
        .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(screen.getByTestId("pathname").textContent).toBe("/skills");
  });

  it("delegates and falls back after a crash without owner remounts", () => {
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
    expect(getNotifications()).toEqual([
      expect.objectContaining({
        title: "Sidebar navigation plugin crashed",
        description:
          "Garden Navbar (garden) stopped working, so bb's own navigation is back.",
      }),
    ]);
  });
});
