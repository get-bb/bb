// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Thread } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { ThreadArchiveCommandHandler } from "./ThreadArchiveCommandHandler";

const keybindings = [
  {
    command: "thread.archive" as const,
    desktopOnly: false,
    shortcut: {
      key: "a",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
  },
];

const archiveAll = vi.spyOn(sdk.threads, "archiveAll");

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

function SplitArchiveHandlers({
  firstPaneThread = firstThread,
  focusedThreadId,
}: {
  firstPaneThread?: Thread;
  focusedThreadId: string | null;
}) {
  return (
    <AppCommandProvider>
      <PaneContext.Provider
        value={paneContext(
          "pane-first",
          focusedThreadId === firstPaneThread.id,
        )}
      >
        <ThreadArchiveCommandHandler thread={firstPaneThread} />
      </PaneContext.Provider>
      <PaneContext.Provider
        value={paneContext("pane-second", focusedThreadId === secondThread.id)}
      >
        <ThreadArchiveCommandHandler thread={secondThread} />
      </PaneContext.Provider>
    </AppCommandProvider>
  );
}

function renderArchiveHandlers(
  props: Parameters<typeof SplitArchiveHandlers>[0],
) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({ keybindings }),
  );
  const app = (nextProps: Parameters<typeof SplitArchiveHandlers>[0]) =>
    wrapper({
      children: (
        <MemoryRouter>
          <ThreadActionsProvider>
            <SplitArchiveHandlers {...nextProps} />
          </ThreadActionsProvider>
        </MemoryRouter>
      ),
    });
  return { view: render(app(props)), app };
}

function pressArchiveShortcut() {
  fireEvent.keyDown(window, {
    key: "A",
    code: "KeyA",
    ctrlKey: true,
    shiftKey: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  archiveAll.mockResolvedValue({ ok: true, archivedThreadIds: [] });
});

describe("ThreadArchiveCommandHandler", () => {
  it("archives only the focused pane's thread as focus changes", async () => {
    const { view, app } = renderArchiveHandlers({
      focusedThreadId: firstThread.id,
    });

    pressArchiveShortcut();
    await waitFor(() => {
      expect(archiveAll).toHaveBeenCalledWith({ threadId: firstThread.id });
    });

    archiveAll.mockClear();
    view.rerender(app({ focusedThreadId: secondThread.id }));
    pressArchiveShortcut();
    await waitFor(() => {
      expect(archiveAll).toHaveBeenCalledWith({ threadId: secondThread.id });
    });
  });

  it("does nothing when no pane is focused", () => {
    renderArchiveHandlers({ focusedThreadId: null });

    pressArchiveShortcut();

    expect(archiveAll).not.toHaveBeenCalled();
  });

  it("does nothing when the focused thread is archived", () => {
    const archivedThread = { ...firstThread, archivedAt: 2 };
    renderArchiveHandlers({
      firstPaneThread: archivedThread,
      focusedThreadId: archivedThread.id,
    });

    pressArchiveShortcut();

    expect(archiveAll).not.toHaveBeenCalled();
  });
});
