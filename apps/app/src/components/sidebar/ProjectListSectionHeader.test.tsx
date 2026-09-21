// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@bb/client-core";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { SPLIT_LAYOUT_STORAGE_KEY } from "@/lib/split-layout/persistence";
import {
  resetPluginThreadRowStatusesForTest,
  setPluginThreadRowStatus,
} from "@/lib/plugin-thread-row-status";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import { SidebarControlButton } from "./SidebarRowControls";
import { SectionThreadDndProvider } from "./SectionThreadDndContext";
import type { SectionThreadDndState } from "./useSectionThreadDnd";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

function dndState(
  dragOverParentKey: string | null,
  activeThread: SectionThreadDndState["activeThread"],
  unchangedParentKey: string | null = null,
): SectionThreadDndState {
  return {
    activeItemId: activeThread?.id ?? null,
    activeThread,
    dragOverParentKey,
    unchangedParentKey,
    consumeClickSuppression: () => false,
    dndContextProps: {},
    itemIdsByParentKey: new Map(),
    onClickCapture: () => undefined,
    nestTarget: null,
    nestPreviewBeforeKey: null,
    reorderTarget: null,
    pinnedItemIds: [],
    pinnedReorderPending: false,
  };
}

function renderSectionWithDrag(state: SectionThreadDndState): string | null {
  const { container } = render(
    <SectionThreadDndProvider value={state}>
      <TopLevelSidebarSection label="Design" dropParentKey="section:design">
        <div>Thread</div>
      </TopLevelSidebarSection>
    </SectionThreadDndProvider>,
  );
  const dropState = container
    .querySelector("[data-sidebar-drop-target]")
    ?.getAttribute("data-sidebar-drop-target");
  cleanup();
  return dropState ?? null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetPluginThreadRowStatusesForTest();
  window.localStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
  window.sessionStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
});

describe("SidebarControlButton", () => {
  it("drops pointer focus before a section action opens a picker", () => {
    let triggerWasFocused = true;
    render(
      <TooltipProvider>
        <SidebarControlButton
          label="New thread"
          icon="MessageSquarePlus"
          onClick={() => {
            triggerWasFocused =
              document.activeElement ===
              screen.getByRole("button", { name: "New thread" });
          }}
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "New thread" });
    trigger.focus();

    fireEvent.click(trigger, { detail: 1 });

    expect(triggerWasFocused).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("retains section-action focus for keyboard activation", () => {
    render(
      <TooltipProvider>
        <SidebarControlButton
          label="New thread"
          icon="MessageSquarePlus"
          onClick={vi.fn()}
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", { name: "New thread" });
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

  it("highlights the whole section only while it is the resolved drop parent", () => {
    const dragged = makeThreadListEntry({ id: "dragged" });

    expect(renderSectionWithDrag(dndState(null, dragged))).toBeNull();
    expect(
      renderSectionWithDrag(dndState("section:other", dragged)),
    ).toBeNull();
    expect(renderSectionWithDrag(dndState("section:design", dragged))).toBe(
      "active",
    );
    expect(renderSectionWithDrag(dndState("section:design", null))).toBeNull();
  });

  it("marks the section a dragged thread already sits in as unchanged", () => {
    const dragged = makeThreadListEntry({ id: "dragged" });

    expect(
      renderSectionWithDrag(dndState(null, dragged, "section:design")),
    ).toBe("unchanged");
    expect(
      renderSectionWithDrag(dndState(null, dragged, "section:other")),
    ).toBeNull();
    expect(
      renderSectionWithDrag(dndState(null, null, "section:design")),
    ).toBeNull();
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

  it("keeps collapsed activity inside the trailing controls slot", () => {
    render(
      <TopLevelSidebarSection
        label="TODO"
        actions={
          <>
            <button type="button">Display</button>
            <button type="button">Actions</button>
            <button type="button">New thread</button>
          </>
        }
        actionsAlwaysVisible
        actionsMobileAlways
        collapsedActivity={{
          ...NO_COLLAPSED_CHILD_ACTIVITY,
          working: true,
          runtimeWorking: true,
        }}
        collapseControl={{ isCollapsed: true, onToggleCollapsed: vi.fn() }}
      >
        <div>Active thread</div>
      </TopLevelSidebarSection>,
    );

    const indicator = screen.getByLabelText("Thread working");
    const activitySlot = indicator.closest(
      "[data-sidebar-collapsed-activity-edge]",
    );
    const trailingControls = activitySlot?.parentElement;

    expect(
      trailingControls?.hasAttribute("data-sidebar-trailing-controls"),
    ).toBe(true);
    expect(trailingControls?.className).toContain("relative");
    expect(activitySlot?.className).toContain("max-md:static");
    expect(screen.queryByText("Active thread")).toBeNull();
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

  it("rolls up a hidden plugin status only while the section is collapsed", () => {
    const renderSection = (isCollapsed: boolean) => (
      <TopLevelSidebarSection
        label="Building"
        collapsedActivity={NO_COLLAPSED_CHILD_ACTIVITY}
        collapsedThreads={[{ id: "thread-one", projectId: "project-one" }]}
        collapseControl={{ isCollapsed, onToggleCollapsed: vi.fn() }}
      >
        <div>Draft thread</div>
      </TopLevelSidebarSection>
    );
    const result = render(renderSection(true));

    expect(screen.queryByLabelText("Plugin improving draft")).toBeNull();
    act(() => {
      setPluginThreadRowStatus("thread-one", "prompt-shaper", {
        icon: "AiContentGenerator01",
        label: "Plugin improving draft",
        tone: "running",
      });
    });

    expect(screen.getByLabelText("Plugin improving draft")).not.toBeNull();
    expect(screen.queryByText("Draft thread")).toBeNull();

    result.rerender(renderSection(false));

    expect(screen.queryByLabelText("Plugin improving draft")).toBeNull();
    expect(screen.getByText("Draft thread")).not.toBeNull();
  });
});
