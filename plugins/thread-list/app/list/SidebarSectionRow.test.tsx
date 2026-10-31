// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCollapsedChildActivity,
  NO_COLLAPSED_CHILD_ACTIVITY,
} from "../model/thread-activity.js";
import type {
  PluginSidebarSplitLayout,
  PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import {
  SIDEBAR_CONTROL_STATE_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
} from "@/components/ui/sidebar-row-classes";

import { makeSidebarThread } from "../model/fixtures.js";

installTestPluginRuntime();
const { SidebarDraftPresenceSync } = await import("./sidebarDraftPresence.js");
const { SidebarSectionRow } = await import("./SidebarSectionRow.js");

type SectionRowProps = Parameters<typeof SidebarSectionRow>[0];

function renderSectionRow(
  props: Partial<SectionRowProps>,
  options: {
    draftThreadIds?: string[];
    splitLayout?: PluginSidebarSplitLayout;
    rowStatuses?: Record<string, PluginSidebarThreadRowStatus>;
  } = {},
) {
  return renderSlot(
    {
      component: (props: SectionRowProps) => (
        <>
          <SidebarDraftPresenceSync />
          <SidebarSectionRow {...props} />
        </>
      ),
    },
    {
      name: "Nested work",
      label: "Nested work",
      depth: 1,
      activity: NO_COLLAPSED_CHILD_ACTIVITY,
      isCollapsed: false,
      onToggleCollapsed: vi.fn(),
      ...props,
    },
    {
      sidebarDraftThreadIds: options.draftThreadIds ?? [],
      sidebarSplitLayout: options.splitLayout,
      sidebarRowStatuses: options.rowStatuses ?? {},
    },
  );
}

afterEach(() => {
  cleanup();
});

describe("SidebarSectionRow", () => {
  it("renders the section name before the disclosure without a sidebar icon", () => {
    const result = renderSectionRow({});

    const disclosure = screen.getByRole("button", {
      name: "Collapse Nested work section",
    });
    const icon = result.container.querySelector('[data-icon="ListView"]');
    const label = screen.getByText("Nested work");
    const row = label.parentElement?.parentElement as HTMLElement | null;

    expect(icon).toBeNull();
    expect(
      label.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(row?.style.paddingLeft).toBe("32px");
    expect(row?.classList.contains(SIDEBAR_GROUP_TEXT_CLASS)).toBe(true);
    for (const token of SIDEBAR_CONTROL_STATE_CLASS.split(" ")) {
      expect(disclosure.classList.contains(token)).toBe(true);
    }
    expect(disclosure.classList.contains("hover:bg-sidebar-accent")).toBe(
      false,
    );
  });

  it("rolls hidden split threads up to the collapsed section row", () => {
    renderSectionRow(
      {
        name: "Build",
        label: "Work / Build",
        activity: { ...NO_COLLAPSED_CHILD_ACTIVITY, pending: true },
        collapsedThreads: [
          makeSidebarThread({ id: "thread-one" }),
          makeSidebarThread({ id: "thread-two" }),
        ],
        isCollapsed: true,
      },
      {
        splitLayout: {
          panes: [
            {
              paneId: "pane-first-thread",
              rect: { x: 0, y: 0, width: 0.34, height: 1 },
              threadId: "thread-one",
              isFocused: false,
            },
            {
              paneId: "pane-compose",
              rect: { x: 0.34, y: 0, width: 0.33, height: 1 },
              threadId: null,
              isFocused: false,
            },
            {
              paneId: "pane-second-thread",
              rect: { x: 0.67, y: 0, width: 0.33, height: 1 },
              threadId: "thread-two",
              isFocused: true,
            },
          ],
        },
      },
    );

    const splitMaps = screen.getAllByRole("img", {
      name: "Work / Build — contains a thread open in split",
    });
    const splitMap = splitMaps[0];
    if (!splitMap) {
      throw new Error("Expected a collapsed split mini-map");
    }
    const slots = splitMap.querySelectorAll("rect");

    expect(slots).toHaveLength(3);
    expect(slots[0]?.getAttribute("class")).toContain("fill-muted-foreground");
    expect(slots[1]?.getAttribute("class")).toContain("fill-none");
    expect(slots[2]?.getAttribute("class")).toContain("fill-primary");
    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
  });

  it("rolls a hidden plugin status up to the collapsed section row", () => {
    renderSectionRow(
      {
        name: "Building",
        label: "Work / Building",
        collapsedThreads: [makeSidebarThread({ id: "thread-one" })],
        isCollapsed: true,
      },
      {
        rowStatuses: {
          "thread-one": {
            icon: "AiContentGenerator01",
            label: "Plugin improving draft",
            tone: "running",
          },
        },
      },
    );

    expect(
      document
        .querySelector("[data-thread-status-glyph]")
        ?.getAttribute("data-row-status"),
    ).toBe("Plugin improving draft");
  });

  it.each([false, true])(
    "keeps a running row's question hidden when another row has a draft (reversed: %s)",
    (reversed) => {
      const threads = [
        makeSidebarThread({
          id: "running",
          runtimeStatus: "active",
          status: "active",
        }),
        makeSidebarThread({ id: "draft", lastReadAt: 1, latestAttentionAt: 1 }),
      ];
      if (reversed) threads.reverse();
      renderSectionRow(
        {
          collapsedThreads: threads,
          activity: getCollapsedChildActivity(threads),
          isCollapsed: true,
        },
        {
          draftThreadIds: ["draft"],
          rowStatuses: {
            running: { icon: "CircleQuestion", label: "Waiting on you" },
          },
        },
      );
      const glyph = document.querySelector("[data-thread-status-glyph]");
      expect(glyph?.getAttribute("data-thread-status-glyph")).toBe("runtime");
      expect(glyph?.getAttribute("data-row-status")).toBeNull();
    },
  );

  it.each([
    { overrides: {}, indicator: "none", waiting: true, archived: false },
    {
      overrides: { hasPendingInteraction: true },
      indicator: "waiting-for-input",
      waiting: false,
      archived: false,
    },
    {
      overrides: { status: "error" as const, isUnread: true },
      indicator: "unread-error",
      waiting: false,
      archived: false,
    },
    {
      overrides: { archivedAt: 1 },
      indicator: "none",
      waiting: false,
      archived: true,
    },
  ])(
    "resolves a single waiting thread before rolling it up ($indicator, archived: $archived)",
    ({ overrides, indicator, waiting, archived }) => {
      const thread = makeSidebarThread({
        id: "waiting",
        lastReadAt: 1,
        latestAttentionAt: 1,
        ...overrides,
      });
      renderSectionRow(
        { collapsedThreads: [thread], isCollapsed: true },
        {
          rowStatuses: {
            waiting: { icon: "CircleQuestion", label: "Waiting on you" },
          },
        },
      );
      const glyph = document.querySelector("[data-thread-status-glyph]");
      expect(glyph?.getAttribute("data-thread-status-glyph")).toBe(
        archived ? "archived" : indicator,
      );
      expect(glyph?.getAttribute("data-row-status")).toBe(
        waiting ? "Waiting on you" : null,
      );
    },
  );

  it("does not roll a plugin status up while the section is expanded", () => {
    renderSectionRow(
      {
        name: "Building",
        label: "Work / Building",
        collapsedThreads: [makeSidebarThread({ id: "thread-one" })],
        isCollapsed: false,
      },
      {
        rowStatuses: {
          "thread-one": {
            icon: "AiContentGenerator01",
            label: "Plugin improving draft",
            tone: "running",
          },
        },
      },
    );

    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
  });
});
