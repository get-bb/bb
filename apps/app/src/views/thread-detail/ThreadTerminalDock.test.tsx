// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "@bb/server-contract";
import type { ThreadTerminalController } from "@/components/thread/terminal/useThreadTerminalController";

const controllerRef = vi.hoisted(() => ({
  current: null as ThreadTerminalController | null,
}));
const runCommandRef = vi.hoisted(() => ({
  current: {
    runCommand: null as string | null,
    states: [] as unknown[],
  },
}));
const startMutate = vi.hoisted(() => vi.fn());
const stopMutate = vi.hoisted(() => vi.fn());
const setDockOpen = vi.hoisted(() => vi.fn());

vi.mock("@/components/thread/terminal/useThreadTerminalController", () => ({
  useThreadTerminalController: () => controllerRef.current,
  terminalStatusLabel: (session: TerminalSession) => session.status,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectRunCommand: () => runCommandRef.current,
}));
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useStartProjectRunCommand: () => ({ mutate: startMutate, isPending: false }),
  useStopProjectRunCommand: () => ({ mutate: stopMutate, isPending: false }),
}));
vi.mock("@/hooks/queries/thread-terminal-queries", () => ({
  useEnvironmentTerminals: () => ({ data: undefined }),
  useTerminals: () => ({ data: undefined }),
}));
vi.mock("@/lib/fixed-panel-tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fixed-panel-tabs")>()),
  useSetFixedSecondaryPanelOpen: () => setDockOpen,
}));
vi.mock("@/components/thread/terminal/ThreadTerminalContent", () => ({
  ThreadTerminalContent: () => <div data-testid="terminal-body" />,
}));
vi.mock("@/components/thread/terminal/ThreadTerminalView", () => ({
  ThreadTerminalView: ({ session }: { session: TerminalSession }) => (
    <div data-testid="run-view">{session.id}</div>
  ),
}));

import { ThreadTerminalDock } from "./ThreadTerminalDock";

function makeSession(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: "term_1",
    title: "shell",
    status: "running",
    threadId: "thr_1",
    environmentId: null,
    hostId: "host",
    initialCwd: "/repo",
    purpose: "user",
    runCommandProjectId: null,
    lastUserInputAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as TerminalSession;
}

function makeController(
  overrides: Partial<ThreadTerminalController> = {},
): ThreadTerminalController {
  return {
    activeSession: null,
    activeTerminalId: null,
    canCreateTerminal: true,
    closingTerminalId: null,
    emptyTerminalMessage: "No terminals",
    handleActiveTerminalTitleChange: vi.fn(),
    handleActiveTerminalUserInput: vi.fn(),
    handleClosePanel: vi.fn(),
    handleCloseTerminal: vi.fn(),
    handleCreateTerminal: vi.fn(),
    handleSelectTerminal: vi.fn(),
    hasTerminalQueryError: false,
    isCreateTerminalPending: false,
    isPanelOpen: true,
    isTerminalQueryLoading: false,
    showTerminalPlaceholders: false,
    shouldRetainActiveTerminalView: false,
    terminalBodyMessage: "No terminals",
    visibleSessions: [],
    ...overrides,
  };
}

function renderDock(props: Partial<Parameters<typeof ThreadTerminalDock>[0]> = {}) {
  return render(
    <ThreadTerminalDock
      threadId="thr_1"
      projectId="proj_1"
      environmentId="env_1"
      isWorktreeEnvironment
      isEnvironmentResolved
      canCreateTerminal
      {...props}
    />,
  ) as unknown as { container: ReactNode };
}

afterEach(() => {
  cleanup();
  controllerRef.current = null;
  runCommandRef.current = { runCommand: null, states: [] };
  startMutate.mockClear();
  stopMutate.mockClear();
  setDockOpen.mockClear();
});

describe("ThreadTerminalDock", () => {
  it("renders manual terminal tabs with close buttons and a working new-terminal button", () => {
    const handleCreateTerminal = vi.fn();
    controllerRef.current = makeController({
      visibleSessions: [makeSession({ id: "term_1", title: "shell" })],
      activeTerminalId: "term_1",
      handleCreateTerminal,
    });
    renderDock();

    expect(screen.getByText("shell")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close shell" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(handleCreateTerminal).toHaveBeenCalledTimes(1);
  });

  it("marks the dock store open while expanded (drives clean-terminal reaping)", () => {
    controllerRef.current = makeController();
    renderDock();
    // Expanded by default -> open true; the controller reaps clean terminals
    // when this flips false on collapse.
    expect(setDockOpen).toHaveBeenCalledWith(true);
  });

  it("shows a pinned, non-closable Run tab when the run command is configured", () => {
    controllerRef.current = makeController();
    runCommandRef.current = {
      runCommand: "pnpm dev",
      states: [
        {
          target: { kind: "environment", environmentId: "env_1" },
          status: "running",
          terminalSessionId: "term_run",
          terminalTarget: { kind: "environment", environmentId: "env_1" },
          updatedAt: 1,
        },
      ],
    };
    renderDock();

    expect(screen.getByText("Run")).toBeTruthy();
    // The Run tab is pinned: it has no close affordance.
    expect(screen.queryByRole("button", { name: /close run/i })).toBeNull();
    // The inline Stop control is available while running.
    expect(screen.getByRole("button", { name: "Stop run command" })).toBeTruthy();
  });

  it("omits the Run tab entirely when no run command is configured", () => {
    controllerRef.current = makeController();
    runCommandRef.current = { runCommand: "", states: [] };
    renderDock();

    expect(screen.queryByText("Run")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /run command/i }),
    ).toBeNull();
  });
});
