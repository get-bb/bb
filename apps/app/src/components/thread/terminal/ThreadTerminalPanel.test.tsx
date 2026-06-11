// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useSetAtom } from "jotai";
import type {
  CloseThreadTerminalRequest,
  CreateThreadTerminalRequest,
  TerminalSession,
  ThreadTerminalListResponse,
  UpdateThreadTerminalRequest,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  createTerminalFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  type FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { getThreadSecondaryPanelOpenAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadTerminalPanel } from "./ThreadTerminalPanel";

const apiMocks = vi.hoisted(() => ({
  closeThreadTerminal: vi.fn(),
  createThreadTerminal: vi.fn(),
  listThreadTerminals: vi.fn(),
  renameThreadTerminal: vi.fn(),
}));

vi.mock("@/lib/api", () => apiMocks);

interface MockThreadTerminalViewProps {
  onTitleChange?: (title: string) => void;
  onUserInput?: () => void;
  session: TerminalSession;
}

vi.mock("./ThreadTerminalView", () => ({
  ThreadTerminalView({
    onTitleChange,
    onUserInput,
    session,
  }: MockThreadTerminalViewProps) {
    return (
      <>
        <button type="button" onClick={onUserInput}>
          Input {session.id}
        </button>
        <button type="button" onClick={() => onTitleChange?.("Edited title")}>
          Title {session.id}
        </button>
      </>
    );
  },
}));

const THREAD_ID = "thr_test";

type TerminalSessionOverrides = Partial<TerminalSession>;

interface TestTerminalPanelHarnessProps {
  canCreateTerminal?: boolean;
}

interface RenderPanelArgs {
  canCreateTerminal?: boolean;
}

interface WriteLegacyBottomTerminalTabsStateArgs {
  activeTerminalId: string;
  terminalIds: readonly string[];
}

let serverSessions: TerminalSession[] = [];

function makeTerminalSession(
  overrides: TerminalSessionOverrides = {},
): TerminalSession {
  return {
    id: "term_1",
    threadId: THREAD_ID,
    environmentId: "env_test",
    hostId: "host_test",
    title: "Terminal 1",
    initialCwd: "/tmp/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    lastUserInputAt: null,
    updatedAt: 1,
    ...overrides,
  };
}

function terminalTabId(terminalId: string): string {
  return `terminal:${encodeURIComponent(terminalId)}`;
}

function readFixedPanelTabsState(): FixedPanelTabsState {
  return parseFixedPanelTabsState({
    initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
    now: Date.now(),
    storedValue: window.localStorage.getItem(
      getFixedPanelTabsStateStorageKey({ threadId: THREAD_ID }),
    ),
  });
}

function writeLegacyBottomTerminalTabsState({
  activeTerminalId,
  terminalIds,
}: WriteLegacyBottomTerminalTabsStateArgs): void {
  const terminalTabs = terminalIds.map((terminalId) =>
    createTerminalFixedPanelTab({ terminalId }),
  );
  const activeTabId = createTerminalFixedPanelTab({
    terminalId: activeTerminalId,
  }).id;
  const state: FixedPanelTabsState = {
    version: EMPTY_FIXED_PANEL_TABS_STATE.version,
    secondary: {
      tabs: [],
      activeTabId: null,
      isOpen: false,
    },
    bottom: {
      tabs: terminalTabs,
      activeTabId,
    },
    lastUsedAt: Date.now(),
  };
  window.localStorage.setItem(
    getFixedPanelTabsStateStorageKey({ threadId: THREAD_ID }),
    JSON.stringify(state),
  );
}

async function listTerminals(): Promise<ThreadTerminalListResponse> {
  return { sessions: [...serverSessions] };
}

async function createTerminal(
  threadId: string,
  request: CreateThreadTerminalRequest,
): Promise<TerminalSession> {
  const terminalNumber = serverSessions.length + 1;
  const session = makeTerminalSession({
    id: `term_${terminalNumber}`,
    threadId,
    title: `Terminal ${terminalNumber}`,
    cols: request.cols,
    rows: request.rows,
    createdAt: terminalNumber,
    updatedAt: terminalNumber,
  });
  serverSessions = [...serverSessions, session];
  return session;
}

async function closeTerminal(
  threadId: string,
  terminalId: string,
  request: CloseThreadTerminalRequest,
): Promise<TerminalSession> {
  const current = serverSessions.find((session) => {
    return session.threadId === threadId && session.id === terminalId;
  });
  if (!current) {
    throw new Error(`Missing terminal ${terminalId}`);
  }

  const closed: TerminalSession = {
    ...current,
    closeReason: request.reason,
    status: "exited",
    updatedAt: current.updatedAt + 1,
  };
  if (request.mode === "if-clean" && current.lastUserInputAt !== null) {
    return current;
  }
  serverSessions = serverSessions.map((session) => {
    return session.id === terminalId ? closed : session;
  });
  return closed;
}

async function renameTerminal(
  threadId: string,
  terminalId: string,
  request: UpdateThreadTerminalRequest,
): Promise<TerminalSession> {
  const current = serverSessions.find((session) => {
    return session.threadId === threadId && session.id === terminalId;
  });
  if (!current) {
    throw new Error(`Missing terminal ${terminalId}`);
  }

  const renamed: TerminalSession = {
    ...current,
    title: request.title,
    updatedAt: current.updatedAt + 1,
  };
  serverSessions = serverSessions.map((session) => {
    return session.id === terminalId ? renamed : session;
  });
  return renamed;
}

function TestTerminalPanelHarness({
  canCreateTerminal = true,
}: TestTerminalPanelHarnessProps) {
  const setPanelOpen = useSetAtom(getThreadSecondaryPanelOpenAtom(THREAD_ID));
  return (
    <>
      <button type="button" onClick={() => setPanelOpen(true)}>
        Show right panel
      </button>
      <button type="button" onClick={() => setPanelOpen(false)}>
        Hide right panel
      </button>
      <ThreadTerminalPanel
        canCreateTerminal={canCreateTerminal}
        threadId={THREAD_ID}
      />
    </>
  );
}

function renderPanel(args: RenderPanelArgs = {}) {
  const harness = createQueryClientTestHarness();
  return render(
    <TestTerminalPanelHarness
      canCreateTerminal={args.canCreateTerminal ?? true}
    />,
    { wrapper: harness.wrapper },
  );
}

beforeEach(() => {
  serverSessions = [];
  window.localStorage.clear();
  apiMocks.listThreadTerminals.mockImplementation(listTerminals);
  apiMocks.createThreadTerminal.mockImplementation(createTerminal);
  apiMocks.closeThreadTerminal.mockImplementation(closeTerminal);
  apiMocks.renameThreadTerminal.mockImplementation(renameTerminal);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("ThreadTerminalPanel", () => {
  it("does not start a terminal just because the right panel opens", async () => {
    renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));

    await waitFor(() => {
      expect(apiMocks.listThreadTerminals).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.createThreadTerminal).not.toHaveBeenCalled();
    expect(screen.getByText("No terminals")).toBeTruthy();
  });

  it("migrates legacy bottom terminal tabs into the active right panel terminal", async () => {
    serverSessions = [
      makeTerminalSession({ id: "term_1", title: "Terminal 1" }),
      makeTerminalSession({
        id: "term_2",
        title: "Terminal 2",
        createdAt: 2,
        updatedAt: 2,
      }),
    ];
    writeLegacyBottomTerminalTabsState({
      activeTerminalId: "term_2",
      terminalIds: ["term_1", "term_2"],
    });

    renderPanel();
    fireEvent.click(screen.getByText("Show right panel"));

    expect(await screen.findByText("Input term_2")).toBeTruthy();
    expect(screen.queryByText("Input term_1")).toBeNull();
    expect(readFixedPanelTabsState().secondary.activeTabId).toBe(
      terminalTabId("term_2"),
    );
    expect(readFixedPanelTabsState().bottom.activeTabId).toBeNull();
  });

  it("closes an unused clean terminal when the right panel is hidden", async () => {
    serverSessions = [makeTerminalSession()];
    renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));
    expect(await screen.findByText("Input term_1")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide right panel"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "if-clean",
          reason: "user",
        },
      );
    });
  });

  it("removes the fixed right panel tab when a clean terminal auto-closes", async () => {
    serverSessions = [makeTerminalSession()];
    renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));
    expect(await screen.findByText("Input term_1")).toBeTruthy();
    await waitFor(() => {
      expect(readFixedPanelTabsState().secondary.activeTabId).toBe(
        terminalTabId("term_1"),
      );
    });

    fireEvent.click(screen.getByText("Hide right panel"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "if-clean",
          reason: "user",
        },
      );
    });
    await waitFor(() => {
      expect(readFixedPanelTabsState().secondary.tabs).toEqual([]);
    });
    expect(readFixedPanelTabsState().secondary.activeTabId).toBeNull();
  });

  it("keeps a terminal after user input when the right panel is hidden", async () => {
    serverSessions = [makeTerminalSession()];
    renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));
    fireEvent.click(await screen.findByText("Input term_1"));
    fireEvent.click(screen.getByText("Hide right panel"));

    expect(apiMocks.closeThreadTerminal).not.toHaveBeenCalled();
  });

  it("closes a clean terminal when the right panel is hidden after remount", async () => {
    serverSessions = [makeTerminalSession()];
    const mounted = renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));
    expect(await screen.findByText("Input term_1")).toBeTruthy();

    mounted.unmount();
    renderPanel();
    expect(await screen.findByText("Input term_1")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide right panel"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "if-clean",
          reason: "user",
        },
      );
    });
  });

  it("explains disconnected terminals and starts a replacement", async () => {
    serverSessions = [
      makeTerminalSession({
        status: "disconnected",
      }),
    ];
    renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));

    expect(await screen.findByText("Terminal disconnected")).toBeTruthy();
    expect(screen.queryByText("This session can't reconnect.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start new terminal" }));

    await waitFor(() => {
      expect(apiMocks.createThreadTerminal).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Input term_2")).toBeTruthy();
  });

  it("renames the active terminal from a terminal title escape", async () => {
    serverSessions = [makeTerminalSession()];
    renderPanel();

    fireEvent.click(screen.getByText("Show right panel"));
    expect(await screen.findByText("Input term_1")).toBeTruthy();

    fireEvent.click(screen.getByText("Title term_1"));

    await waitFor(() => {
      expect(apiMocks.renameThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          title: "Edited title",
        },
      );
    });
  });
});
