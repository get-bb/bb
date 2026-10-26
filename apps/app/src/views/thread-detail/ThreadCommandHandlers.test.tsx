// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Thread } from "@bb/domain";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { defaultAppSettings } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { toThreadActionTarget } from "@/lib/thread-actions/thread-action-target";
import {
  ThreadActionCollectors,
  resetThreadActionRegistryForTest,
} from "@/lib/thread-actions/thread-action-registry";
import { PaneThreadActionCommandHandler } from "./PaneThreadActionCommandHandler";

const mocks = vi.hoisted(() => ({
  requestArchiveThreads: vi.fn<(threads: readonly Thread[]) => void>(),
  requestDeleteThreads: vi.fn(),
}));
const sdkThreads = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  unarchive: vi.fn(),
  get: vi.fn(),
}));

const testState = vi.hoisted(() => {
  const keybinding = (
    command: "thread.archive" | "thread.markRead" | "thread.pin",
    key: string,
  ) => ({
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
  });
  return {
    keybindings: [
      keybinding("thread.archive", "a"),
      keybinding("thread.markRead", "m"),
      keybinding("thread.pin", "p"),
    ],
  };
});

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkThreads } }));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => mocks,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindings: testState.keybindings,
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

function makeThread(id: string, title: string): Thread {
  return makeThreadFixture({
    createdAt: 1,
    id,
    lastReadAt: null,
    latestAttentionAt: 1,
    title,
    titleFallback: null,
    updatedAt: 1,
  });
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

function SplitHandlers({
  firstPaneThread = firstThread,
  focusedThreadId,
}: {
  firstPaneThread?: Thread;
  focusedThreadId: string | null;
}) {
  const queryClient = new QueryClient();
  for (const thread of [firstPaneThread, secondThread]) {
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
  }
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThreadActionCollectors
          coreRegistrations={CORE_THREAD_ACTIONS}
          requestRename={() => {}}
        />
        <AppCommandProvider>
          <PaneContext.Provider
            value={paneContext(
              "pane-first",
              focusedThreadId === firstPaneThread.id,
            )}
          >
            <PaneThreadActionCommandHandler
              thread={toThreadActionTarget(firstPaneThread, null)}
            />
          </PaneContext.Provider>
          <PaneContext.Provider
            value={paneContext(
              "pane-second",
              focusedThreadId === secondThread.id,
            )}
          >
            <PaneThreadActionCommandHandler
              thread={toThreadActionTarget(secondThread, null)}
            />
          </PaneContext.Provider>
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function pressShortcut(letter: "A" | "M" | "P") {
  fireEvent.keyDown(window, {
    key: letter,
    code: `Key${letter}`,
    ctrlKey: true,
    shiftKey: true,
  });
}

const PANE_COMMANDS = [
  {
    command: "thread.archive",
    letter: "A",
    targets: () =>
      mocks.requestArchiveThreads.mock.calls.flatMap(([threads]) =>
        threads.map((thread) => thread.id),
      ),
  },
  {
    command: "thread.pin",
    letter: "P",
    targets: () => sdkThreads.pin.mock.calls.map(([args]) => args.threadId),
  },
  {
    command: "thread.markRead",
    letter: "M",
    targets: () =>
      sdkThreads.markRead.mock.calls.map(([args]) => args.threadId),
  },
] as const;

beforeEach(() => {
  sdkThreads.pin.mockImplementation(async ({ threadId }) => ({
    ...makeThread(threadId, threadId),
    pinnedAt: 9,
  }));
  sdkThreads.markRead.mockImplementation(async ({ threadId }) => ({
    ...makeThread(threadId, threadId),
    lastReadAt: 9,
  }));
});

afterEach(() => {
  cleanup();
  resetThreadActionRegistryForTest();
  vi.clearAllMocks();
});

describe("pane thread action command handler", () => {
  it.each(PANE_COMMANDS)(
    "runs $command for the focused pane's thread as focus changes",
    async ({ letter, targets }) => {
      const view = render(<SplitHandlers focusedThreadId={firstThread.id} />);

      pressShortcut(letter);
      await waitFor(() => expect(targets()).toEqual([firstThread.id]));

      view.rerender(<SplitHandlers focusedThreadId={secondThread.id} />);
      pressShortcut(letter);
      await waitFor(() =>
        expect(targets()).toEqual([firstThread.id, secondThread.id]),
      );
    },
  );

  it.each(PANE_COMMANDS)(
    "does nothing for $command when no pane is focused",
    async ({ letter, targets }) => {
      render(<SplitHandlers focusedThreadId={null} />);

      pressShortcut(letter);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(targets()).toEqual([]);
    },
  );

  it("does nothing when the focused thread is archived", async () => {
    const archivedThread = { ...firstThread, archivedAt: 2 };
    render(
      <SplitHandlers
        firstPaneThread={archivedThread}
        focusedThreadId={archivedThread.id}
      />,
    );

    pressShortcut("A");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.requestArchiveThreads).not.toHaveBeenCalled();
  });
});
