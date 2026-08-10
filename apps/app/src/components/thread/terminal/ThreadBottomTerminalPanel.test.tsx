// @vitest-environment jsdom

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadBottomTerminalPanel } from "./ThreadBottomTerminalPanel";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn(),
  select: vi.fn(),
  setHeight: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtom: () => [36, mocks.setHeight],
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  const Slot = ({ children }: { children?: ReactNode }) =>
    React.createElement("div", null, children);
  return {
    Panel: Slot,
    PanelGroup: Slot,
    PanelResizeHandle: Slot,
  };
});

vi.mock("./ThreadTerminalContent", async () => {
  const React = await import("react");
  return {
    ThreadTerminalContent: () =>
      React.createElement("div", { "data-testid": "terminal-content" }),
  };
});

vi.mock("./useThreadTerminalController", () => ({
  terminalStatusLabel: (session: { status: string }) => session.status,
  useThreadTerminalController: () => ({
    activeSession: null,
    activeTerminalId: "term-a",
    canCreateTerminal: true,
    closingTerminalId: null,
    emptyTerminalMessage: "No terminals",
    handleActiveTerminalTitleChange: vi.fn(),
    handleActiveTerminalUserInput: vi.fn(),
    handleClosePanel: vi.fn(),
    handleCloseTerminal: mocks.close,
    handleCreateTerminal: mocks.create,
    handleSelectTerminal: mocks.select,
    hasTerminalQueryError: false,
    isCreateTerminalPending: false,
    isPanelOpen: true,
    isTerminalQueryLoading: false,
    showTerminalPlaceholders: false,
    shouldRetainActiveTerminalView: false,
    terminalBodyMessage: "No terminals",
    visibleSessions: [
      {
        id: "term-a",
        title: "Shell A",
        status: "running",
      },
      {
        id: "term-b",
        title: "Build",
        status: "disconnected",
      },
    ],
  }),
}));

describe("ThreadBottomTerminalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a bottom rail available while collapsed", () => {
    const onOpenChange = vi.fn();
    render(
      <ThreadBottomTerminalPanel
        canCreateTerminal
        createRequestNonce={0}
        isOpen={false}
        onOpenChange={onOpenChange}
        threadId="thr-test"
      >
        <div>Thread timeline</div>
      </ThreadBottomTerminalPanel>,
    );

    expect(screen.getByText("Thread timeline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("terminal-content")).toBeNull();
  });

  it("renders multi-session controls in the expanded panel", () => {
    const onOpenChange = vi.fn();
    render(
      <ThreadBottomTerminalPanel
        canCreateTerminal
        createRequestNonce={0}
        isOpen
        onOpenChange={onOpenChange}
        threadId="thr-test"
      >
        <div>Thread timeline</div>
      </ThreadBottomTerminalPanel>,
    );

    expect(screen.getByText("Shell A")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.getByText("disconnected")).toBeTruthy();
    expect(screen.getByTestId("terminal-content")).toBeTruthy();

    fireEvent.click(screen.getByText("Build"));
    expect(mocks.select).toHaveBeenCalledWith("term-b");
    fireEvent.click(screen.getByRole("button", { name: "Close Build" }));
    expect(mocks.close).toHaveBeenCalledWith("term-b");
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse terminal panel" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
