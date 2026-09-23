// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import type {
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useSidebarReorderDnd } from "./app/ui/useSidebarReorderDnd.js";

vi.mock("./app/ui/useSidebarReorderDnd.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./app/ui/useSidebarReorderDnd.js")>();
  return {
    ...actual,
    useSidebarReorderDnd: vi.fn(actual.useSidebarReorderDnd),
  };
});

const app = await loadPluginApp(() => import("./app"));
const registration = app.experimentalSidebarNavigations[0];
if (!registration) throw new Error("navigation slot not registered");

function hostItem(
  id: string,
  label: string,
  action: ExperimentalSidebarNavigationItem["action"],
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  return {
    id,
    label,
    icon: { kind: "host", name: "new-thread" },
    action,
    isDisabled: false,
    isVisible: true,
    isLoading: false,
    pluginId: null,
    shortcut: null,
    experimental_Accessory: null,
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
    experimental_Accessory: null,
    ...overrides,
  };
}

const ITEMS = [
  hostItem(
    "__bb__/new-thread",
    "New thread",
    { kind: "new-thread" },
    {
      shortcut: { label: "⌘N", ariaKeyShortcuts: "Meta+N" },
    },
  ),
  hostItem(
    "__bb__/search-threads",
    "Search threads",
    { kind: "search-threads" },
    { isVisible: false },
  ),
  panelItem("docs", "main", "Docs"),
  panelItem("tasks", "board", "Tasks", {
    experimental_Accessory: () => <span>7</span>,
  }),
  hostItem("__bb__/skills", "Skills", { kind: "open-skills" }),
];

const PROPS: ExperimentalSidebarNavigationProps = {
  isCompactViewport: false,
  experimental_Original: () => null,
};

function renderNavigation(
  items: readonly ExperimentalSidebarNavigationItem[] = ITEMS,
  isShortcutModifierHeld = false,
) {
  return renderSlot(registration!, PROPS, {
    sidebarNavigation: {
      items,
      activeItemId: "docs/main",
      isShortcutModifierHeld,
    },
  });
}

function rowOrder(): string[] {
  return Array.from(
    document.querySelectorAll("[data-sidebar-navigation-item]"),
    (row) => row.getAttribute("data-sidebar-navigation-item") ?? "",
  );
}

afterEach(cleanup);

describe("navigation plugin", () => {
  it("draws visible items in saved order and keeps hidden ones in More", () => {
    renderNavigation();

    expect(rowOrder()).toEqual([
      "__bb__/new-thread",
      "docs/main",
      "tasks/board",
      "__bb__/skills",
    ]);
    expect(
      screen.getByRole("button", { name: "More sidebar navigation" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Docs" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByText("7")).toBeDefined();
  });

  it("does not mark New thread as the current page, like bb's rows", () => {
    renderSlot(registration!, PROPS, {
      sidebarNavigation: { items: ITEMS, activeItemId: "__bb__/new-thread" },
    });

    expect(
      screen
        .getByRole("button", { name: "New thread (⌘N)" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("activates through the host, splitting on modifier click", () => {
    const view = renderNavigation();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: "docs/main", openInSplit: true },
      { method: "activate", itemId: "__bb__/skills", openInSplit: false },
    ]);
  });

  it("hides a panel and opens bb's editor from the row menu", async () => {
    const view = renderNavigation();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Hide from sidebar" }),
    );
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "New thread (⌘N)" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize sidebar" }),
    );

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      { method: "setVisible", itemId: "docs/main", isVisible: false },
      { method: "openCustomize" },
    ]);
  });

  it("reveals the New thread shortcut only while the modifier is held", () => {
    renderNavigation(ITEMS, false);
    expect(screen.queryByText("⌘N")).toBeNull();
    cleanup();

    renderNavigation(ITEMS, true);
    expect(screen.getByText("⌘N")).toBeDefined();
  });

  it("keeps hidden items in place when reordering visible ones", () => {
    const view = renderNavigation();
    const options = vi.mocked(useSidebarReorderDnd).mock.lastCall?.[0];
    if (!options) throw new Error("reorder handler is not mounted");

    act(() =>
      options.onDragEnd({
        active: { id: "docs/main" },
        over: { id: "tasks/board" },
      } as DragEndEvent),
    );

    expect(view.inspection.sidebarNavigationCalls).toEqual([
      {
        method: "setOrder",
        itemIds: [
          "__bb__/new-thread",
          "__bb__/search-threads",
          "tasks/board",
          "docs/main",
          "__bb__/skills",
        ],
      },
    ]);
  });
});
