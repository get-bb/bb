// @vitest-environment jsdom

import type { TerminalSession } from "@bb/server-contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import type { ThreadTerminalController } from "./useThreadTerminalController";

const threadTerminalView = vi.hoisted(() =>
  vi.fn((_props: { autoFocus: boolean; isPanelOpen: boolean }) => null),
);

vi.mock("./ThreadTerminalView", () => ({
  ThreadTerminalView: threadTerminalView,
}));

const session: TerminalSession = {
  id: "term_1",
  threadId: "thr_1",
  environmentId: "env_1",
  hostId: "host_1",
  title: "Terminal",
  initialCwd: "/workspace",
  cols: 100,
  rows: 30,
  status: "running",
  exitCode: null,
  closeReason: null,
  createdAt: 1,
  updatedAt: 1,
  lastUserInputAt: null,
};

function controller(isPanelOpen: boolean): ThreadTerminalController {
  return {
    activeSession: session,
    activeTerminalId: session.id,
    canCreateTerminal: true,
    closingTerminalId: null,
    emptyTerminalMessage: "No terminals",
    handleActiveTerminalSessionChange: () => undefined,
    handleActiveTerminalTitleChange: () => undefined,
    handleActiveTerminalUserInput: () => undefined,
    handleClosePanel: () => undefined,
    handleCloseTerminal: () => undefined,
    handleCreateTerminal: () => undefined,
    handleSelectTerminal: () => undefined,
    hasTerminalQueryError: false,
    isCreateTerminalPending: false,
    isPanelOpen,
    isTerminalQueryLoading: false,
    showTerminalPlaceholders: false,
    shouldRetainActiveTerminalView: false,
    terminalBodyMessage: "No terminals",
    visibleSessions: [session],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadTerminalContent", () => {
  it("does not mount the terminal view until the panel opens", () => {
    const rendered = render(
      <ThreadTerminalContent
        autoFocus={false}
        controller={controller(false)}
      />,
    );

    expect(threadTerminalView).not.toHaveBeenCalled();
    expect(rendered.container.firstChild).toBeNull();

    rendered.rerender(
      <ThreadTerminalContent autoFocus controller={controller(true)} />,
    );

    expect(threadTerminalView).toHaveBeenCalledOnce();
    expect(threadTerminalView.mock.calls[0]?.[0]).toMatchObject({
      autoFocus: true,
      isPanelOpen: true,
    });
  });
});
