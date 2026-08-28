// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import * as threadActionsProvider from "@/components/thread/ThreadActionsProvider";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { ThreadRenameCommandHandler } from "./ThreadRenameCommandHandler";

const requestRename = vi.fn();

const testState = {
  keybindings: [
    {
      command: "thread.rename" as const,
      desktopOnly: false,
      shortcut: {
        key: "r",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
    },
  ],
};

vi.spyOn(threadActionsProvider, "useThreadActions").mockReturnValue({
  archiveThreadAndChildren: vi.fn(),
  renameThread: vi.fn(),
  requestDelete: vi.fn(),
  requestRename,
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
});

function makeThread(id: string, title: string): Thread {
  return {
    archivedAt: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_test",
    id,
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_test",
    providerId: "codex",
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title,
    titleFallback: null,
    updatedAt: 1,
  };
}

const firstThread = makeThread("thr_first", "First pane title");
const secondThread = makeThread("thr_second", "Second pane title");

function paneContext(paneId: string, isFocused: boolean): PaneContextValue {
  return {
    beginPaneDrag: undefined,
    isBoundedPane: true,
    isFocused,
    isMaximized: false,
    isSplitPane: true,
    isTopRow: true,
    navigateInPane: vi.fn(),
    onMoveToSide: undefined,
    onRequestClose: vi.fn(),
    onToggleMaximize: vi.fn(),
    ownsWindowTopLeft: paneId === "pane-first",
    paneId,
    reservesWindowPanelToggle: false,
    secondaryPanelHost: null,
  };
}

function SplitRenameHandlers({
  focusedThreadId,
}: {
  focusedThreadId: string | null;
}) {
  return (
    <AppCommandProvider>
      <PaneContext.Provider
        value={paneContext("pane-first", focusedThreadId === firstThread.id)}
      >
        <ThreadRenameCommandHandler thread={firstThread} />
      </PaneContext.Provider>
      <PaneContext.Provider
        value={paneContext("pane-second", focusedThreadId === secondThread.id)}
      >
        <ThreadRenameCommandHandler thread={secondThread} />
      </PaneContext.Provider>
    </AppCommandProvider>
  );
}

function pressRenameShortcut() {
  fireEvent.keyDown(window, {
    key: "R",
    code: "KeyR",
    ctrlKey: true,
    shiftKey: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderHandlers(focusedThreadId: string | null) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      keybindings: testState.keybindings,
      defaultKeybindings: testState.keybindings,
    }),
  );
  return render(<SplitRenameHandlers focusedThreadId={focusedThreadId} />, {
    wrapper,
  });
}

describe("ThreadRenameCommandHandler", () => {
  it("routes rename to the focused pane's thread as focus changes", () => {
    const view = renderHandlers(firstThread.id);

    pressRenameShortcut();
    expect(requestRename.mock.calls).toEqual([[firstThread]]);

    requestRename.mockClear();
    view.rerender(<SplitRenameHandlers focusedThreadId={secondThread.id} />);
    pressRenameShortcut();
    expect(requestRename.mock.calls).toEqual([[secondThread]]);
  });

  it("does not request rename when no pane is focused", () => {
    renderHandlers(null);

    pressRenameShortcut();

    expect(requestRename).not.toHaveBeenCalled();
  });
});
