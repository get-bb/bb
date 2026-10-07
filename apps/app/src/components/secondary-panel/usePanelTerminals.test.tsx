// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  TerminalCreateTarget,
  TerminalSession,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BbHttpError, sdk } from "@/lib/sdk";
import {
  createNewTabFixedPanelTab,
  createTerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  resetFixedPanelTabsStateForTest,
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { isRootComposeTerminalSession } from "@/views/RootComposeView";
import { usePanelTerminals } from "./usePanelTerminals";

const commandHandlers = vi.hoisted(
  () => new Map<string, () => boolean | void>(),
);

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: { terminals: { create: vi.fn(), close: vi.fn() } },
  };
});

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (command: string, handler: () => boolean | void) => {
    commandHandlers.set(command, handler);
  },
}));

interface SurfaceCase {
  name: string;
  createTarget: TerminalCreateTarget;
  acceptsSession: (session: TerminalSession) => boolean;
  tabsCarryTarget: boolean;
  own: TerminalSession;
  sibling: TerminalSession;
  foreign: TerminalSession | null;
}

const ENVIRONMENT_TARGET = {
  kind: "environment",
  environmentId: "env_1",
} as const;

const SURFACES: readonly SurfaceCase[] = [
  {
    name: "thread view",
    createTarget: { kind: "thread", threadId: "thr_1" },
    acceptsSession: (session) => session.threadId === "thr_1",
    tabsCarryTarget: false,
    own: makeTerminalSession({ id: "term_own", threadId: "thr_1" }),
    sibling: makeTerminalSession({ id: "term_sibling", threadId: "thr_1" }),
    foreign: makeTerminalSession({
      id: "term_foreign",
      threadId: null,
      environmentId: "env_1",
    }),
  },
  {
    name: "New thread screen",
    createTarget: ENVIRONMENT_TARGET,
    acceptsSession: (session) =>
      isRootComposeTerminalSession(session, ENVIRONMENT_TARGET),
    tabsCarryTarget: false,
    own: makeTerminalSession({
      id: "term_own",
      threadId: null,
      environmentId: "env_1",
    }),
    sibling: makeTerminalSession({
      id: "term_sibling",
      threadId: null,
      environmentId: "env_1",
    }),
    foreign: makeTerminalSession({
      id: "term_foreign",
      threadId: "thr_1",
      environmentId: "env_1",
    }),
  },
  {
    name: "plugin page",
    createTarget: { kind: "host_path", hostId: "host_1", cwd: null },
    acceptsSession: () => true,
    tabsCarryTarget: true,
    own: makeTerminalSession({
      id: "term_own",
      threadId: null,
      environmentId: "env_1",
    }),
    sibling: makeTerminalSession({
      id: "term_sibling",
      threadId: null,
      environmentId: null,
      hostId: "host_1",
      initialCwd: "/tmp",
    }),
    foreign: null,
  },
];

const PANEL_STATE_ID = "panel-terminals-contract";

function renderSurface(surface: SurfaceCase, isFocused = true) {
  const { wrapper } = createQueryClientTestHarness();
  return renderHook(
    () => ({
      terminals: usePanelTerminals({
        panelStateId: PANEL_STATE_ID,
        syncThreadId: null,
        createTarget: surface.createTarget,
        isFocused,
        acceptsSession: surface.acceptsSession,
        tabsCarryTarget: surface.tabsCarryTarget,
        reveal: () => undefined,
      }),
      state: useFixedPanelTabsState(PANEL_STATE_ID, null),
      updateState: useUpdateFixedPanelTabsState(PANEL_STATE_ID, null),
    }),
    { wrapper },
  );
}

function terminalTabIds(
  state: ReturnType<typeof useFixedPanelTabsState>,
): string[] {
  return state.secondary.tabs.flatMap((tab) =>
    tab.kind === "terminal" ? [tab.terminalId] : [],
  );
}

function activeTerminalId(
  state: ReturnType<typeof useFixedPanelTabsState>,
): string | null {
  const active = state.secondary.tabs.find(
    (tab) => tab.id === state.secondary.activeTabId,
  );
  return active?.kind === "terminal" ? active.terminalId : null;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  commandHandlers.clear();
  localStorage.clear();
  resetFixedPanelTabsStateForTest();
});

describe.each(SURFACES)("panel terminals on the $name", (surface) => {
  it("opens one tab per terminal and keeps the latest one selected", async () => {
    const { result } = renderSurface(surface);

    act(() => {
      expect(result.current.terminals.open(surface.own)).toBe(true);
      expect(result.current.terminals.open(surface.sibling)).toBe(true);
      expect(result.current.terminals.open(surface.sibling)).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(terminalTabIds(result.current.state)).toEqual([
      surface.own.id,
      surface.sibling.id,
    ]);
    expect(activeTerminalId(result.current.state)).toBe(surface.sibling.id);
    expect(result.current.terminals.autoFocusTerminalId).toBe(
      surface.sibling.id,
    );
  });

  it("refuses exited terminals and terminals outside its scope", () => {
    const { result } = renderSurface(surface);
    const exited = { ...surface.own, status: "exited" as const };

    act(() => {
      expect(result.current.terminals.open(exited)).toBe(false);
      if (surface.foreign !== null) {
        expect(result.current.terminals.open(surface.foreign)).toBe(false);
      }
    });

    expect(terminalTabIds(result.current.state)).toEqual([]);
  });

  it("starts a terminal in its scope in place of the New tab page", async () => {
    vi.mocked(sdk.terminals.create).mockResolvedValue(surface.own);
    const { result } = renderSurface(surface);
    act(() =>
      result.current.updateState((state) => ({
        ...state,
        secondary: {
          ...state.secondary,
          tabs: [createNewTabFixedPanelTab()],
          activeTabId: createNewTabFixedPanelTab().id,
        },
      })),
    );

    act(() => result.current.terminals.start());

    await waitFor(() => {
      expect(activeTerminalId(result.current.state)).toBe(surface.own.id);
    });
    expect(sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: surface.createTarget }),
    );
    expect(result.current.state.secondary.tabs).toEqual([
      createTerminalFixedPanelTab({
        terminalId: surface.own.id,
        target: surface.tabsCarryTarget ? surface.createTarget : undefined,
      }),
    ]);
  });

  it("starts a terminal from the shortcut only while focused", async () => {
    vi.mocked(sdk.terminals.create).mockResolvedValue(surface.own);
    renderSurface(surface, false);
    expect(commandHandlers.get("terminal.open")?.()).toBe(false);

    cleanup();
    commandHandlers.clear();
    const { result } = renderSurface(surface, true);
    act(() => {
      expect(commandHandlers.get("terminal.open")?.()).toBe(true);
    });

    await waitFor(() => {
      expect(activeTerminalId(result.current.state)).toBe(surface.own.id);
    });
  });

  it("removes each tab only after its overlapping close succeeds", async () => {
    let finishFirstClose!: (session: TerminalSession) => void;
    let finishSecondClose!: (session: TerminalSession) => void;
    const firstClose = new Promise<TerminalSession>((resolve) => {
      finishFirstClose = resolve;
    });
    const secondClose = new Promise<TerminalSession>((resolve) => {
      finishSecondClose = resolve;
    });
    vi.mocked(sdk.terminals.close)
      .mockReturnValueOnce(firstClose)
      .mockReturnValueOnce(secondClose);
    const { result } = renderSurface(surface);
    act(() => {
      result.current.terminals.open(surface.own);
      result.current.terminals.open(surface.sibling);
    });

    act(() => {
      result.current.terminals.close(surface.own.id);
      result.current.terminals.close(surface.sibling.id);
    });

    await waitFor(() => expect(sdk.terminals.close).toHaveBeenCalledTimes(2));
    expect(terminalTabIds(result.current.state)).toEqual([
      surface.own.id,
      surface.sibling.id,
    ]);

    await act(async () => {
      finishFirstClose({ ...surface.own, status: "exited" });
      await firstClose;
    });
    await waitFor(() => {
      expect(terminalTabIds(result.current.state)).toEqual([
        surface.sibling.id,
      ]);
    });

    await act(async () => {
      finishSecondClose({ ...surface.sibling, status: "exited" });
      await secondClose;
    });

    await waitFor(() => {
      expect(terminalTabIds(result.current.state)).toEqual([]);
    });
    expect(sdk.terminals.close).toHaveBeenCalledWith({
      mode: "force",
      terminalId: surface.own.id,
    });
  });

  it("removes the tab of a terminal that no longer exists and keeps it when closing fails", async () => {
    vi.mocked(sdk.terminals.close).mockImplementation(({ terminalId }) =>
      Promise.reject(
        terminalId === surface.own.id
          ? new BbHttpError({
              status: 404,
              code: "terminal_not_found",
              message: "Terminal session not found",
              body: {
                code: "terminal_not_found",
                message: "Terminal session not found",
              },
            })
          : new BbHttpError({
              status: 503,
              code: "host_unavailable",
              message: "Host is not connected",
              body: {
                code: "host_unavailable",
                message: "Host is not connected",
              },
            }),
      ),
    );
    const { result } = renderSurface(surface);
    act(() => {
      result.current.terminals.open(surface.own);
      result.current.terminals.open(surface.sibling);
    });

    act(() => {
      result.current.terminals.close(surface.own.id);
    });
    await waitFor(() => {
      expect(terminalTabIds(result.current.state)).toEqual([
        surface.sibling.id,
      ]);
    });

    await act(async () => {
      result.current.terminals.close(surface.sibling.id);
    });
    await waitFor(() => expect(sdk.terminals.close).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(terminalTabIds(result.current.state)).toEqual([surface.sibling.id]);
  });
});
