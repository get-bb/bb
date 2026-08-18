// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { SPLIT_LAYOUT_STORAGE_KEY } from "@/lib/split-layout/persistence";
import { SidebarSectionRow } from "./SidebarSectionRow";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
  window.sessionStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
});

describe("SidebarSectionRow", () => {
  it("renders the section name before the disclosure without a sidebar icon", () => {
    const result = render(
      <SidebarSectionRow
        name="Nested work"
        label="Nested work"
        depth={1}
        activity={NO_COLLAPSED_CHILD_ACTIVITY}
        isCollapsed={false}
        onToggleCollapsed={vi.fn()}
      />,
    );

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
  });

  it("rolls hidden split threads up to the collapsed section row", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-second-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.34, 0.33, 0.33],
        children: [
          {
            type: "pane",
            paneId: "pane-first-thread",
            content: {
              kind: "thread",
              projectId: "project-one",
              threadId: "thread-one",
            },
          },
          {
            type: "pane",
            paneId: "pane-compose",
            content: { kind: "new-thread" },
          },
          {
            type: "pane",
            paneId: "pane-second-thread",
            content: {
              kind: "thread",
              projectId: "project-two",
              threadId: "thread-two",
            },
          },
        ],
      },
    });

    render(
      <Provider store={store}>
        <SidebarSectionRow
          name="Build"
          label="Work / Build"
          depth={1}
          activity={{
            ...NO_COLLAPSED_CHILD_ACTIVITY,
            pending: true,
          }}
          collapsedThreads={[
            { id: "thread-one", projectId: "project-one" },
            { id: "thread-two", projectId: "project-two" },
          ]}
          isCollapsed
          onToggleCollapsed={vi.fn()}
        />
      </Provider>,
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
});
