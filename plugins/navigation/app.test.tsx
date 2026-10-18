// @vitest-environment jsdom

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ExperimentalBadge,
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const rail = app.experimentalSidebarNavigations.find(
  (registration) => registration.id === "rail",
);
const topList = app.experimentalSidebarNavigations.find(
  (registration) => registration.id === "top-list",
);
if (!rail || !topList) throw new Error("navigation providers not registered");
const RailHeader = rail.headerComponent;
if (!RailHeader) throw new Error("Rail registers no header");

function hostItem(
  id: string,
  label: string,
  action: ExperimentalSidebarNavigationItem["action"],
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  return {
    id,
    label,
    icon: { kind: "host", name: "extensions" },
    action,
    isDisabled: false,
    isVisible: true,
    isLoading: false,
    pluginId: null,
    shortcut: null,
    badge: null,
    ...overrides,
  };
}

function panelItem(
  pluginId: string,
  panelId: string,
  label: string,
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  return {
    id: `${pluginId}/${panelId}`,
    label,
    icon: { kind: "plugin", pluginId, icon: "BookOpen" },
    action: { kind: "open-plugin-panel", pluginId, panelId },
    isDisabled: false,
    isVisible: true,
    isLoading: false,
    pluginId,
    shortcut: null,
    badge: null,
    ...overrides,
  };
}

const NEW_THREAD = hostItem(
  "__bb__/new-thread",
  "New thread",
  { kind: "new-thread" },
  { shortcut: { label: "⌘N", ariaKeyShortcuts: "Meta+N" } },
);
const SEARCH = hostItem(
  "__bb__/search-threads",
  "Search threads",
  { kind: "search-threads" },
  { isVisible: false },
);
const PLUGINS = hostItem("__bb__/extensions", "Plugins", {
  kind: "open-extensions",
});
const DOCS = panelItem("garden", "docs", "Docs");
const ALERTS = panelItem("garden", "alerts", "Alerts");

function props(
  placement: ExperimentalSidebarNavigationProps["placement"],
): ExperimentalSidebarNavigationProps {
  return {
    isCompactViewport: false,
    placement,
    experimental_Original: () => null,
  };
}

function renderRail(
  items: readonly ExperimentalSidebarNavigationItem[],
  activeItemId: string | null = null,
) {
  return renderSlot(rail!, props("rail"), {
    sidebarNavigation: {
      items,
      activeItemId,
      isHomeActive: activeItemId === null,
    },
  });
}

function renderTopList(
  items: readonly ExperimentalSidebarNavigationItem[],
  activeItemId: string | null = null,
) {
  return renderSlot(topList!, props("list"), {
    sidebarNavigation: { items, activeItemId },
  });
}

function railLabels(): (string | null)[] {
  return within(screen.getByTestId("app-nav-rail"))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

function badgeOf(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>("[data-nav-rail-badge]");
}

function withBadge(
  item: ExperimentalSidebarNavigationItem,
  badge: ExperimentalBadge,
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  return { ...item, badge, ...overrides };
}

afterEach(cleanup);

describe("Rail", () => {
  it("draws Home and the visible destinations, leaving New thread to the header and hidden ones to More", () => {
    renderRail([NEW_THREAD, SEARCH, PLUGINS, DOCS]);

    expect(railLabels()).toEqual(["Home", "Plugins", "Docs", "More"]);
    expect(
      screen.getByRole("button", { name: "Home" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks the active destination instead of Home", () => {
    renderRail([NEW_THREAD, PLUGINS, DOCS], DOCS.id);

    expect(
      screen.getByRole("button", { name: "Docs" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "Home" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("activates through the host, opening in a split on a modifier click", () => {
    const view = renderRail([NEW_THREAD, PLUGINS, DOCS]);

    fireEvent.click(screen.getByRole("button", { name: "Docs" }), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: DOCS.id, openInSplit: true },
      { method: "activate", itemId: PLUGINS.id, openInSplit: false },
      { method: "goHome" },
    ]);
  });

  it("caps rail counts at 9+ and names the badge in the destination's label", () => {
    renderRail([
      withBadge(DOCS, { count: 9, label: "9 drafts" }),
      withBadge(ALERTS, { count: 10, label: "10 alerts" }),
    ]);

    expect(
      badgeOf(screen.getByRole("button", { name: "Docs, 9 drafts" }))
        ?.textContent,
    ).toBe("9");
    expect(
      badgeOf(screen.getByRole("button", { name: "Alerts, 10 alerts" }))
        ?.textContent,
    ).toBe("9+");
  });

  it("draws a text badge as a dot in its tone, since the rail has no room for text", () => {
    renderRail([
      withBadge(DOCS, { text: "2 down", tone: "critical", label: "2 down" }),
    ]);

    const mark = badgeOf(screen.getByRole("button", { name: "Docs, 2 down" }));
    expect(mark?.dataset.navRailBadge).toBe("dot");
    expect(mark?.dataset.navBadgeTone).toBe("critical");
    expect(mark?.textContent).toBe("");
  });

  it("marks More with the strongest tone hidden under it and lists the hidden badges in its name", () => {
    renderRail([
      PLUGINS,
      withBadge(DOCS, { count: 2, label: "2 drafts" }, { isVisible: false }),
      withBadge(
        ALERTS,
        { tone: "warning", label: "1 due today" },
        { isVisible: false },
      ),
    ]);

    const more = screen.getByRole("button", {
      name: "More, Docs: 2 drafts, Alerts: 1 due today",
    });
    expect(badgeOf(more)?.dataset.navBadgeTone).toBe("warning");
  });

  it("offers plugin actions only on plugin destinations", async () => {
    const view = renderRail([PLUGINS, DOCS]);

    fireEvent.contextMenu(screen.getByRole("button", { name: "Plugins" }));
    const hostMenu = await screen.findByRole("menu", {
      name: "Plugins options",
    });
    expect(
      within(hostMenu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Hide from rail", "Customize navigation"]);
    fireEvent.click(
      within(hostMenu).getByRole("menuitem", { name: "Hide from rail" }),
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
    const panelMenu = await screen.findByRole("menu", {
      name: "Docs panel options",
    });
    fireEvent.click(
      within(panelMenu).getByRole("menuitem", { name: "View details" }),
    );

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "setVisible", itemId: PLUGINS.id, isVisible: false },
      { method: "openDetails", itemId: DOCS.id },
    ]);
  });
});

describe("Rail header", () => {
  function renderHeader(
    items: readonly ExperimentalSidebarNavigationItem[],
    isShortcutModifierHeld = false,
  ) {
    return renderSlot(
      { component: RailHeader! },
      { width: 200, controlSize: 28, isCompactViewport: false },
      { sidebarNavigation: { items, isShortcutModifierHeld } },
    );
  }

  it("draws New thread even when it is hidden from the rail", () => {
    const view = renderHeader([{ ...NEW_THREAD, isVisible: false }, PLUGINS]);

    fireEvent.click(screen.getByRole("button", { name: "New thread (⌘N)" }));

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: NEW_THREAD.id, openInSplit: false },
    ]);
  });

  it("shows the shortcut only while the modifier is held", () => {
    renderHeader([NEW_THREAD]);
    expect(screen.queryByText("⌘N")).toBeNull();
    cleanup();

    renderHeader([NEW_THREAD], true);
    expect(screen.getByText("⌘N")).toBeDefined();
  });

  it("draws nothing when the host offers no New thread", () => {
    renderHeader([PLUGINS]);

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Top list", () => {
  function rowLabels(): string[] {
    return Array.from(
      document.querySelectorAll("[data-sidebar-navigation-item]"),
      (row) => row.getAttribute("data-sidebar-navigation-item") ?? "",
    );
  }

  it("draws New thread as a row, never as the current page", () => {
    renderTopList([NEW_THREAD, PLUGINS, DOCS], NEW_THREAD.id);

    expect(rowLabels()).toEqual([NEW_THREAD.id, PLUGINS.id, DOCS.id]);
    expect(
      screen
        .getByRole("button", { name: "New thread (⌘N)" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("shows More only when something is hidden, and activates hidden items from it", async () => {
    renderTopList([NEW_THREAD, PLUGINS]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    cleanup();

    const view = renderTopList([NEW_THREAD, SEARCH, PLUGINS]);
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Search threads" }),
    );

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: SEARCH.id, openInSplit: false },
    ]);
  });

  it("draws list counts up to 99+ and text badges as text", () => {
    renderTopList([
      withBadge(DOCS, { count: 120, label: "120 drafts" }),
      withBadge(ALERTS, { text: "NEW", label: "New alerts" }),
    ]);

    const counts = Array.from(
      document.querySelectorAll<HTMLElement>("[data-nav-rail-badge]"),
      (mark) => `${mark.dataset.navRailBadge}:${mark.textContent}`,
    );
    expect(counts).toEqual(["count:99+", "text:NEW"]);
    expect(
      screen.getByRole("button", { name: "Docs, 120 drafts" }),
    ).toBeDefined();
  });

  it("hides a row from its options button", async () => {
    const view = renderTopList([NEW_THREAD, DOCS]);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Docs panel options" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "setVisible", itemId: DOCS.id, isVisible: false },
    ]);
  });
});
