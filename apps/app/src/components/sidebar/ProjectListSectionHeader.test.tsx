// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { SPLIT_LAYOUT_STORAGE_KEY } from "@/lib/split-layout/persistence";
import {
  ProjectListSectionIconButton,
  TopLevelSidebarSection,
} from "./ProjectList";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
  window.sessionStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
});

describe("ProjectListSectionIconButton", () => {
  it("drops pointer focus before a section action opens a picker", () => {
    let triggerWasFocused = true;
    render(
      <TooltipProvider>
        <ProjectListSectionIconButton
          ariaLabel="New project"
          icon={<span aria-hidden>+</span>}
          title="New project"
          onClick={() => {
            triggerWasFocused =
              document.activeElement ===
              screen.getByRole("button", { name: "New project" });
          }}
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "New project" });
    trigger.focus();

    fireEvent.click(trigger, { detail: 1 });

    expect(triggerWasFocused).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("retains section-action focus for keyboard activation", () => {
    render(
      <TooltipProvider>
        <ProjectListSectionIconButton
          ariaLabel="New project"
          icon={<span aria-hidden>+</span>}
          title="New project"
          onClick={vi.fn()}
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "New project" });
    trigger.focus();

    fireEvent.click(trigger, { detail: 0 });

    expect(document.activeElement).toBe(trigger);
  });
});

describe("TopLevelSidebarSection", () => {
  it("exposes stable identity only for persisted sections", () => {
    const result = render(
      <>
        <TopLevelSidebarSection
          label="Design"
          sectionId="sec_design"
          collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
        >
          <div>Design thread</div>
        </TopLevelSidebarSection>
        <TopLevelSidebarSection
          label="Pinned"
          collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
        >
          <div>Pinned thread</div>
        </TopLevelSidebarSection>
      </>,
    );

    expect(
      result.container.querySelector('[data-sidebar-section-id="sec_design"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByTitle("Pinned")
        .closest("[data-sidebar-sticky-group]")
        ?.hasAttribute("data-sidebar-section-id"),
    ).toBe(false);
  });

  it("hides the section body and exposes an expand action when collapsed", () => {
    render(
      <TopLevelSidebarSection
        label="Pinned"
        collapseControl={{ isCollapsed: true, onToggleCollapsed: vi.fn() }}
      >
        <div>Pinned thread</div>
      </TopLevelSidebarSection>,
    );

    expect(screen.queryByText("Pinned thread")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand Pinned section" }),
    ).not.toBeNull();
  });

  it("renders the disclosure after the section label without a leading icon", () => {
    const result = render(
      <TopLevelSidebarSection
        label="Pinned"
        collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
      >
        <div>Pinned thread</div>
      </TopLevelSidebarSection>,
    );

    const disclosure = screen.getByRole("button", {
      name: "Collapse Pinned section",
    });
    const icon = result.container.querySelector('[data-icon="Pin"]');
    const label = screen.getByTitle("Pinned");

    expect(icon).toBeNull();
    expect(
      label.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("rolls a hidden split thread up to a collapsed top-level section", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-thread",
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
        ],
      },
    });

    render(
      <Provider store={store}>
        <TopLevelSidebarSection
          label="Pinned"
          collapsedActivity={NO_COLLAPSED_CHILD_ACTIVITY}
          collapsedThreads={[{ id: "thread-one", projectId: "project-one" }]}
          collapseControl={{ isCollapsed: true, onToggleCollapsed: vi.fn() }}
        >
          <div>Pinned thread</div>
        </TopLevelSidebarSection>
      </Provider>,
    );

    expect(
      screen.getByRole("img", {
        name: "Pinned — contains a thread open in split",
      }),
    ).not.toBeNull();
    expect(screen.queryByText("Pinned thread")).toBeNull();
  });
});
