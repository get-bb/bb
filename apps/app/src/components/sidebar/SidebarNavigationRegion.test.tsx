// @vitest-environment jsdom

import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalSidebarNavigationActions,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk";
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
import {
  resolveCustomizeFocusReturnTarget,
  SidebarNavigationRegion,
} from "./SidebarNavigationRegion";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";
import {
  useSidebarNavigation,
  useSidebarNavigationSplit,
} from "@/lib/plugin-sidebar-navigation";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  openNewThreadInSplit: vi.fn(),
  openInSplit: vi.fn(),
  onNewChat: vi.fn(),
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
  }: {
    builtInEntries?: Array<{
      id: string;
      title: string;
      onActivate: MouseEventHandler<HTMLButtonElement>;
    }>;
  }) => (
    <div>
      {builtInEntries.map((entry) => (
        <button key={entry.id} type="button" onClick={entry.onActivate}>
          {entry.title}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitActions: () => ({
    beginDrag: vi.fn(),
    isCompact: false,
    openInSplit: mocks.openInSplit,
  }),
  usePaneContentSplitDrag: () => ({
    onPointerDown: undefined,
    openInSplit: vi.fn(),
  }),
}));

const capturedActions: {
  current: ExperimentalSidebarNavigationActions | null;
} = { current: null };

function ReplacementItem({ id }: { id: string }) {
  const { activeItemId, actions, items } = useSidebarNavigation();
  const split = useSidebarNavigationSplit(id);
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return null;
  return (
    <button
      type="button"
      aria-current={activeItemId === item.id ? "page" : undefined}
      {...split.splitProps}
      onClick={(event) =>
        actions.activate(item.id, {
          openInSplit: event.metaKey || event.ctrlKey,
        })
      }
    >
      {item.label}
    </button>
  );
}

function Replacement({
  experimental_Original: Original,
}: ExperimentalSidebarNavigationProps) {
  const { actions, items } = useSidebarNavigation();
  const [delegate, setDelegate] = useState(false);
  const [crash, setCrash] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => {
    capturedActions.current = actions;
  }, [actions]);
  if (crash) throw new Error("navigation fixture crash");
  if (delegate) return <Original />;
  return (
    <div data-testid="replacement-navigation">
      <ol aria-label="Visible items">
        {items
          .filter((item) => item.isVisible)
          .map((item) => (
            <li key={item.id}>
              <ReplacementItem id={item.id} />
            </li>
          ))}
      </ol>
      <ol aria-label="Hidden items">
        {items
          .filter((item) => !item.isVisible)
          .map((item) => (
            <li key={item.id}>{item.id}</li>
          ))}
      </ol>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Local count {count}
      </button>
      <button type="button" onClick={() => actions.openCustomize()}>
        Customize replacement
      </button>
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
  return <div data-testid="retained-owner">Retained thread list</div>;
}

function Harness({ onOwnerMount }: { onOwnerMount: () => void }) {
  const [isCustomizing, setCustomizing] = useState(false);
  const focusReturnTargetRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef}>
      <SidebarNavigationModelProvider
        onNavigate={vi.fn()}
        onNewChat={mocks.onNewChat}
        onSearchThreads={mocks.onSearchThreads}
        onOpenCustomize={() => {
          focusReturnTargetRef.current = resolveCustomizeFocusReturnTarget(
            containerRef.current,
          );
          setCustomizing(true);
        }}
        splitEnabled
      >
        <SidebarNavigationRegion
          isCustomizing={isCustomizing}
          onCustomizingChange={setCustomizing}
          focusReturnTargetRef={focusReturnTargetRef}
          splitEnabled
          newThreadSplit={{ openInSplit: mocks.openNewThreadInSplit }}
          onNavigate={vi.fn()}
          onNewChat={mocks.onNewChat}
          onSearchThreads={mocks.onSearchThreads}
        />
      </SidebarNavigationModelProvider>
      <RetainedOwner onMount={onOwnerMount} />
      <LocationProbe />
    </div>
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
  resetNotificationStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
  mocks.dispatch.mockReset();
  mocks.openNewThreadInSplit.mockReset();
  mocks.openInSplit.mockReset();
  mocks.onNewChat.mockReset();
  mocks.onSearchThreads.mockReset();
  capturedActions.current = null;
});

function listedItems(name: string): string[] {
  return screen.getByRole("list", { name }).textContent?.length
    ? Array.from(
        screen.getByRole("list", { name }).querySelectorAll("li"),
        (item) => item.textContent ?? "",
      )
    : [];
}

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

    act(() =>
      capturedActions.current?.activate("__bb__/search-threads", {
        openInSplit: false,
      }),
    );

    expect(mocks.onSearchThreads).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("thread.search", null);
    expect(
      screen.queryByRole("combobox", { name: "Search threads" }),
    ).toBeNull();
    expect(screen.getByTestId("replacement-navigation")).toBeDefined();
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

  it("hands providers every item in saved order with host visibility", () => {
    registerFixture();
    renderHarness();

    expect(listedItems("Visible items")).toEqual([
      "New thread",
      "Plugins",
      "Skills",
      "Docs",
    ]);
    expect(listedItems("Hidden items")).toEqual(["__bb__/search-threads"]);
  });

  it("persists visibility and order changes through the actions", () => {
    registerFixture();
    renderHarness();

    act(() => capturedActions.current?.setVisible("garden/docs", false));
    expect(listedItems("Hidden items")).toEqual([
      "__bb__/search-threads",
      "garden/docs",
    ]);

    act(() => capturedActions.current?.setVisible("garden/docs", true));
    act(() =>
      capturedActions.current?.setOrder([
        "garden/docs",
        "unknown/item",
        "__bb__/skills",
      ]),
    );
    expect(listedItems("Visible items")).toEqual([
      "Docs",
      "Skills",
      "New thread",
      "Plugins",
    ]);
  });

  it("opens in split only when the provider asks for it", () => {
    registerFixture();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }), {
      metaKey: true,
    });
    expect(mocks.openInSplit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          kind: "plugin-panel",
          pluginId: "garden",
          panelPath: "docs",
          subPath: "",
        },
      }),
    );
    expect(screen.getByTestId("pathname").textContent).toBe("/");

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(mocks.onNewChat).toHaveBeenCalledOnce();
  });

  it("swaps in bb's customize editor and keeps the provider mounted", async () => {
    registerFixture();
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Local count 0" }));
    const trigger = screen.getByRole("button", {
      name: "Customize replacement",
    });
    trigger.focus();

    fireEvent.click(trigger);
    expect(
      document.querySelector('[data-sidebar-navigation-customize-mode="true"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Customize replacement" }),
    ).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(
      document.querySelector('[data-sidebar-navigation-customize-mode="true"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Local count 1" })).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Customize replacement" }),
    );
  });

  it("ignores actions from a provider that has unmounted", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerFixture();
    renderHarness();
    const staleActions = capturedActions.current;

    fireEvent.click(screen.getByRole("button", { name: "Crash replacement" }));
    act(() =>
      staleActions?.activate("__bb__/extensions", { openInSplit: false }),
    );

    expect(screen.getByTestId("pathname").textContent).toBe("/");
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
