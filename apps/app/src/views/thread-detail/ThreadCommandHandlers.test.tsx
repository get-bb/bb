// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { defaultAppSettings } from "@bb/domain";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { ThreadArchiveCommandHandler } from "./ThreadArchiveCommandHandler";
import { ThreadRenameCommandHandler } from "./ThreadRenameCommandHandler";

const mocks = vi.hoisted(() => ({
  requestArchive: vi.fn(),
  requestRename: vi.fn(),
}));

const testState = vi.hoisted(() => {
  const keybinding = (
    command: "thread.archive" | "thread.rename",
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
      keybinding("thread.rename", "r"),
    ],
  };
});

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    requestArchive: mocks.requestArchive,
    requestRename: mocks.requestRename,
  }),
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

type ThreadCommandHandler = ComponentType<{ thread: Thread }>;

function SplitHandlers({
  Handler,
  firstPaneThread = firstThread,
  focusedThreadId,
}: {
  Handler: ThreadCommandHandler;
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
        <Handler thread={firstPaneThread} />
      </PaneContext.Provider>
      <PaneContext.Provider
        value={paneContext("pane-second", focusedThreadId === secondThread.id)}
      >
        <Handler thread={secondThread} />
      </PaneContext.Provider>
    </AppCommandProvider>
  );
}

function pressShortcut(letter: "A" | "R") {
  fireEvent.keyDown(window, {
    key: letter,
    code: `Key${letter}`,
    ctrlKey: true,
    shiftKey: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each([
  {
    command: "archive",
    Handler: ThreadArchiveCommandHandler,
    request: mocks.requestArchive,
    letter: "A" as const,
  },
  {
    command: "rename",
    Handler: ThreadRenameCommandHandler,
    request: mocks.requestRename,
    letter: "R" as const,
  },
])("thread $command command handler", ({ Handler, request, letter }) => {
  it("routes the command to the focused pane's thread as focus changes", () => {
    const view = render(
      <SplitHandlers Handler={Handler} focusedThreadId={firstThread.id} />,
    );

    pressShortcut(letter);
    expect(request.mock.calls).toEqual([[firstThread]]);

    request.mockClear();
    view.rerender(
      <SplitHandlers Handler={Handler} focusedThreadId={secondThread.id} />,
    );
    pressShortcut(letter);
    expect(request.mock.calls).toEqual([[secondThread]]);
  });

  it("does nothing when no pane is focused", () => {
    render(<SplitHandlers Handler={Handler} focusedThreadId={null} />);

    pressShortcut(letter);

    expect(request).not.toHaveBeenCalled();
  });
});

describe("ThreadArchiveCommandHandler", () => {
  it("does nothing when the focused thread is archived", () => {
    const archivedThread = { ...firstThread, archivedAt: 2 };
    render(
      <SplitHandlers
        Handler={ThreadArchiveCommandHandler}
        firstPaneThread={archivedThread}
        focusedThreadId={archivedThread.id}
      />,
    );

    pressShortcut("A");

    expect(mocks.requestArchive).not.toHaveBeenCalled();
  });
});
