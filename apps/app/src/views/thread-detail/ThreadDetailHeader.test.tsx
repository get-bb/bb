// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import {
  ThreadActionCollectors,
  resetThreadActionRegistryForTest,
} from "@/lib/thread-actions/thread-action-registry";
import type { ThreadDetailHeaderActionsMenuArgs } from "./ThreadDetailHeader";

const mocks = vi.hoisted(() => ({
  renameThreadAsync: vi.fn(),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThreadAsync: mocks.renameThreadAsync,
  }),
}));

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

const viewportState = vi.hoisted(() => ({ isCompactViewport: false }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      keybindings: [
        {
          command: "thread.rename",
          desktopOnly: false,
          shortcut: {
            key: "r",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ],
    },
  }),
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewportState.isCompactViewport,
}));

const THREAD_ID = "thr_header";

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
  resetThreadActionRegistryForTest();
  viewportState.isCompactViewport = false;
  mocks.renameThreadAsync.mockReset();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete window.bbDesktop;
});

describe("ThreadDetailHeader", () => {
  it("leaves the open right-panel collapse control to the panel header", () => {
    render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={THREAD_ID}
          threadTitle="Panel state"
        />
      </PaneContext.Provider>,
    );

    expect(
      screen.queryByRole("button", { name: "Hide right panel" }),
    ).toBeNull();
  });

  it("retains the compact trigger while the open shelf hides page actions", () => {
    viewportState.isCompactViewport = true;

    render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={THREAD_ID}
          threadTitle="Panel state"
        />
      </PaneContext.Provider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Hide right panel",
    });
    expect(trigger.closest("[data-thread-header-pane-actions]")).not.toBeNull();
  });

  it.each([
    { expectedIcon: "PanelRight", isCompactViewport: true },
    { expectedIcon: "PanelRight", isCompactViewport: false },
  ])(
    "shows the $expectedIcon glyph on the right-panel trigger",
    ({ expectedIcon, isCompactViewport }) => {
      viewportState.isCompactViewport = isCompactViewport;

      render(
        <PaneContext.Provider value={PANE_CONTEXT}>
          <ThreadDetailHeader
            actionsMenu={null}
            childPillLabel={null}
            isSecondaryPanelOpen={false}
            onOpenThreadGitAction={vi.fn()}
            onToggleSecondaryPanel={vi.fn()}
            threadHeaderGitActions={[]}
            threadId={THREAD_ID}
            threadTitle="Panel state"
          />
        </PaneContext.Provider>,
      );

      const showButton = screen.getByRole("button", {
        name: "Show right panel",
      });
      expect(
        showButton.querySelector(`[data-icon="${expectedIcon}"]`),
      ).not.toBeNull();
    },
  );

  it("keeps thread Full Screen in a split header while its panel is open", () => {
    render(
      <PaneContext.Provider
        value={{
          ...PANE_CONTEXT,
          isSplitPane: true,
          secondaryPanelHost: { clear: vi.fn(), publish: vi.fn() },
          onToggleMaximize: vi.fn(),
        }}
      >
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={THREAD_ID}
          threadTitle="Split panel state"
        />
      </PaneContext.Provider>,
    );

    expect(
      screen.getByRole("button", { name: /Maximize pane/ }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Hide right panel" }),
    ).toBeNull();
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
          actionsMenu={({ includeResponsiveActions }) => (
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
          threadId={THREAD_ID}
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
          actionsMenu={({ includeResponsiveActions }) => (
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
          threadId={THREAD_ID}
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

  it("edits the title inline after a double click and commits on Enter", async () => {
    mocks.renameThreadAsync.mockResolvedValue(undefined);
    render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={THREAD_ID}
          threadTitle="Focused thread"
        />
      </PaneContext.Provider>,
    );

    fireEvent.doubleClick(screen.getByText("Focused thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(input).toHaveProperty("value", "Focused thread");
    expect(screen.queryByText("Focused thread")).toBeNull();

    fireEvent.change(input, { target: { value: "Renamed thread" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.renameThreadAsync).toHaveBeenCalledWith(
        THREAD_ID,
        "Renamed thread",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull(),
    );
    expect(screen.getByText("Focused thread")).not.toBeNull();
  });

  it("discards an unsaved header draft when switching threads", async () => {
    const header = (threadId: string, threadTitle: string) => (
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={threadId}
          threadTitle={threadTitle}
        />
      </PaneContext.Provider>
    );
    const { rerender } = render(header(THREAD_ID, "Focused thread"));

    fireEvent.doubleClick(screen.getByText("Focused thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "Unsaved draft" } });

    rerender(header("thr_other", "Other thread"));

    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    expect(screen.getByText("Other thread")).not.toBeNull();
    expect(mocks.renameThreadAsync).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByText("Other thread"));
    expect(
      await screen.findByRole("textbox", { name: "Thread name" }),
    ).toHaveProperty("value", "Other thread");
  });

  it("keeps the header title out of the macOS window-drag region so double click renames", async () => {
    window.bbDesktop = createBbDesktopApi({
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0-test",
    });
    render(
      <PaneContext.Provider value={PANE_CONTEXT}>
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={THREAD_ID}
          threadTitle="Focused thread"
        />
      </PaneContext.Provider>,
    );

    const title = screen.getByText("Focused thread").closest("p");
    expect(title?.className).toContain("[-webkit-app-region:no-drag]");

    fireEvent.doubleClick(screen.getByText("Focused thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(input.closest("p")?.className).toContain(
      "[-webkit-app-region:no-drag]",
    );
  });

  it("does not start a pane drag while the header title is being edited", async () => {
    const beginPaneDrag = vi.fn();
    render(
      <PaneContext.Provider
        value={{
          ...PANE_CONTEXT,
          isSplitPane: true,
          beginPaneDrag,
        }}
      >
        <ThreadDetailHeader
          actionsMenu={null}
          childPillLabel={null}
          isSecondaryPanelOpen={false}
          onOpenThreadGitAction={vi.fn()}
          onToggleSecondaryPanel={vi.fn()}
          threadHeaderGitActions={[]}
          threadId={THREAD_ID}
          threadTitle="Focused thread"
        />
      </PaneContext.Provider>,
    );

    fireEvent.doubleClick(screen.getByText("Focused thread"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    fireEvent.pointerDown(input, { button: 0 });

    expect(beginPaneDrag).not.toHaveBeenCalled();
  });

  function renderWithMenuArgs(focused = true) {
    const menuArgs: { current: ThreadDetailHeaderActionsMenuArgs | null } = {
      current: null,
    };
    const requestRenameDialog = vi.fn();
    render(
      <AppCommandProvider>
        <ThreadActionCollectors
          coreRegistrations={[]}
          requestRename={requestRenameDialog}
        />
        <PaneContext.Provider value={{ ...PANE_CONTEXT, isFocused: focused }}>
          <ThreadDetailHeader
            actionsMenu={(args) => {
              menuArgs.current = args;
              return null;
            }}
            childPillLabel={null}
            isSecondaryPanelOpen={false}
            onOpenThreadGitAction={vi.fn()}
            onToggleSecondaryPanel={vi.fn()}
            threadHeaderGitActions={[]}
            threadId={THREAD_ID}
            threadTitle="Focused thread"
          />
        </PaneContext.Provider>
      </AppCommandProvider>,
    );
    return { menuArgs, requestRenameDialog };
  }

  it("renames inline from the actions menu once the menu has closed on desktop", async () => {
    const { menuArgs, requestRenameDialog } = renderWithMenuArgs();
    menuArgs.current?.requestRename(THREAD_ID);
    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    const closeEvent = new Event("focusout", { cancelable: true });
    menuArgs.current?.onCloseAutoFocus(closeEvent);

    expect(closeEvent.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole("textbox", { name: "Thread name" }),
    ).toHaveProperty("value", "Focused thread");
    expect(requestRenameDialog).not.toHaveBeenCalled();
  });

  it("opens the rename dialog from the actions menu at compact width", () => {
    viewportState.isCompactViewport = true;
    const { menuArgs, requestRenameDialog } = renderWithMenuArgs();
    menuArgs.current?.requestRename(THREAD_ID);
    const closeEvent = new Event("focusout", { cancelable: true });
    menuArgs.current?.onCloseAutoFocus(closeEvent);

    expect(requestRenameDialog).toHaveBeenCalledWith(THREAD_ID);
    expect(closeEvent.defaultPrevented).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "starts the inline rename from the rename command when focused=%s",
    async (focused, edits) => {
      renderWithMenuArgs(focused);
      fireEvent.keyDown(window, {
        key: "R",
        code: "KeyR",
        ctrlKey: true,
        shiftKey: true,
      });
      if (edits) {
        expect(
          await screen.findByRole("textbox", { name: "Thread name" }),
        ).not.toBeNull();
      } else {
        expect(
          screen.queryByRole("textbox", { name: "Thread name" }),
        ).toBeNull();
      }
    },
  );
});
