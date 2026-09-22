// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@bb/client-core";
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
} from "../rows/sidebarRowClasses.js";

installTestPluginRuntime();
const { SidebarSectionRow } = await import("./SidebarSectionRow.js");

type SectionRowProps = Parameters<typeof SidebarSectionRow>[0];

function renderSectionRow(
  props: Partial<SectionRowProps>,
  options: {
    splitLayout?: PluginSidebarSplitLayout;
    rowStatuses?: Record<string, PluginSidebarThreadRowStatus>;
  } = {},
) {
  return renderSlot(
    { component: SidebarSectionRow },
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
        collapsedThreads: [{ id: "thread-one" }, { id: "thread-two" }],
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
    expect(screen.queryByLabelText("Thread needs user input")).toBeNull();
  });

  it("rolls a hidden plugin status up to the collapsed section row", () => {
    renderSectionRow(
      {
        name: "Building",
        label: "Work / Building",
        collapsedThreads: [{ id: "thread-one" }],
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

    expect(screen.getAllByLabelText("Plugin improving draft")).not.toHaveLength(
      0,
    );
  });

  it("does not roll a plugin status up while the section is expanded", () => {
    renderSectionRow(
      {
        name: "Building",
        label: "Work / Building",
        collapsedThreads: [{ id: "thread-one" }],
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

    expect(screen.queryByLabelText("Plugin improving draft")).toBeNull();
  });
});
