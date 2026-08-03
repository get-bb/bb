// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import { PaneContext, type PaneContextValue } from "./PaneContext";

vi.mock("@/components/layout/AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  HEADER_PANE_ACTION_ICON_BUTTON_CLASS: "header-pane-action-button",
  AppPageHeader: ({
    actions,
    center,
    className,
    headerRef,
  }: {
    actions?: ReactNode;
    center?: ReactNode;
    className?: string;
    headerRef?: Ref<HTMLElement>;
  }) => (
    <header ref={headerRef} className={className}>
      {center}
      {actions}
    </header>
  ),
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

const PANE_CONTEXT: PaneContextValue = {
  paneId: "main",
  isFocused: true,
  isSplitPane: false,
  secondaryPanelHost: null,
  reservesWindowPanelToggle: false,
  onRequestClose: null,
  isMaximized: false,
  onToggleMaximize: null,
  isBoundedPane: false,
  isTopRow: true,
  ownsWindowTopLeft: true,
  navigateInPane: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadDetailHeader", () => {
  it("keeps the thread header visually separated from the timeline", () => {
    const { container } = render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadTitle="Header separator"
        />
      </PaneContext.Provider>,
    );

    const header = container.querySelector("header");
    expect(header?.classList).toContain("border-b");
    expect(header?.classList).toContain("border-border-seam-vertical/60");
  });

  it("uses a neutral disclosure state for the right-panel toggle", () => {
    render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadTitle="Panel state"
        />
      </PaneContext.Provider>,
    );

    const toggle = screen.getByRole("button", { name: "Hide right panel" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
  });

  it("moves secondary controls into overflow for narrow split panes", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 360,
      top: 0,
      width: 360,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const splitContext: PaneContextValue = {
      ...PANE_CONTEXT,
      isFocused: true,
      isSplitPane: true,
      beginPaneDrag: vi.fn(),
    };

    render(
      <PaneContext.Provider value={splitContext}>
        <ThreadDetailHeader
          actionsMenu={(includeResponsiveActions) => (
            <>
              <span>Thread menu</span>
              {includeResponsiveActions ? (
                <span>Responsive menu actions</span>
              ) : null}
            </>
          )}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onClosePane={vi.fn()}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[
            { label: "Commit", target: { kind: "commit" } },
          ]}
          threadTitle="Narrow split"
          workspaceOpenButton={<button>Open workspace</button>}
        />
      </PaneContext.Provider>,
    );

    expect(screen.queryByText("Open workspace")).toBeNull();
    expect(screen.queryByText("Commit")).toBeNull();
    expect(screen.getByText("Thread menu")).not.toBeNull();
    expect(screen.getByText("Responsive menu actions")).not.toBeNull();
    const closePane = screen.getByRole("button", { name: "Close pane" });
    expect(closePane.classList).toContain("header-pane-action-button");
    const closeIcon = closePane.querySelector('[data-icon="CloseThreadPane"]');
    expect(closeIcon).not.toBeNull();
    expect(closeIcon?.querySelectorAll("path")).toHaveLength(1);
    expect(closeIcon?.querySelector("path")?.getAttribute("d")).toContain(
      "M18 6L6.00081 17.9992",
    );
  });

  it("keeps responsive controls inline and out of the menu for wide split panes", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 720,
      top: 0,
      width: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const splitContext: PaneContextValue = {
      ...PANE_CONTEXT,
      isFocused: true,
      isSplitPane: true,
      beginPaneDrag: vi.fn(),
    };

    render(
      <PaneContext.Provider value={splitContext}>
        <ThreadDetailHeader
          actionsMenu={(includeResponsiveActions) => (
            <>
              <span>Thread menu</span>
              {includeResponsiveActions ? (
                <span>Responsive menu actions</span>
              ) : null}
            </>
          )}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onClosePane={vi.fn()}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[
            { label: "Commit", target: { kind: "commit" } },
          ]}
          threadTitle="Wide split"
          workspaceOpenButton={<button>Open workspace</button>}
        />
      </PaneContext.Provider>,
    );

    expect(screen.getByText("Open workspace")).not.toBeNull();
    expect(screen.getByText("Commit")).not.toBeNull();
    expect(screen.getByText("Thread menu")).not.toBeNull();
    expect(screen.queryByText("Responsive menu actions")).toBeNull();
  });

  it("renders serialized mentions in the thread title as pills", () => {
    const { container } = render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadTitle="Review @docs/foo.test.ts with @thread:thr_worker"
        />
      </PaneContext.Provider>,
    );

    expect(screen.getByTitle("docs/foo.test.ts")).not.toBeNull();
    expect(screen.getByText("thr_worker")).not.toBeNull();
    expect(
      container.querySelectorAll('[data-prompt-mention="true"]'),
    ).toHaveLength(2);
    expect(screen.queryByText("@thread:thr_worker")).toBeNull();
  });

  it("uses a title tab for the focused split and no pane-wide dimming", () => {
    const splitContext: PaneContextValue = {
      ...PANE_CONTEXT,
      isFocused: true,
      isSplitPane: true,
      beginPaneDrag: vi.fn(),
    };
    const { container, rerender } = render(
      <PaneContext.Provider value={splitContext}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel="child"
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadTitle="Focused thread"
        />
      </PaneContext.Provider>,
    );

    const focusedTab = container.querySelector<HTMLElement>(
      "[data-pane-header-focus-tab]",
    );
    expect(focusedTab).not.toBeNull();
    expect(focusedTab?.classList).toContain("bg-state-active");
    expect(focusedTab?.classList).not.toContain("shadow-sm");
    expect(container.querySelector("[data-app-page-header-dim]")).toBeNull();
    const activeTitle = screen.getByText("Focused thread");
    expect(activeTitle.classList).toContain("font-normal");
    expect(activeTitle.classList).not.toContain("font-medium");
    expect(screen.getByText("child")).not.toBeNull();

    rerender(
      <PaneContext.Provider value={{ ...splitContext, isFocused: false }}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel="child"
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadTitle="Focused thread"
        />
      </PaneContext.Provider>,
    );

    expect(container.querySelector("[data-pane-header-focus-tab]")).toBeNull();
    const inactiveTitle = screen.getByText("Focused thread");
    expect(inactiveTitle.classList).toContain("text-muted-foreground/60");
    expect(inactiveTitle.classList).toContain("font-normal");
    expect(inactiveTitle.classList).not.toContain("font-medium");
  });
});
