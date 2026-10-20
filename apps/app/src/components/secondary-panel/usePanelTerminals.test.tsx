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
import { useTerminalStart } from "@/components/thread/terminal/pending-terminals";
import { usePanelTerminals } from "./usePanelTerminals";

const commandHandlers = vi.hoisted(
  () => new Map<string, () => boolean | void>(),
);

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: { terminals: { create: vi.fn(), close: vi.fn(), get: vi.fn() } },
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

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function hostUnavailableError(): BbHttpError {
  return new BbHttpError({
    status: 503,
    code: "host_unavailable",
    message: "Host is not connected",
    body: { code: "host_unavailable", message: "Host is not connected" },
  });
}

function requestedTerminalId(call: number): string {
  const id = vi.mocked(sdk.terminals.create).mock.calls[call]?.[0].id;
  if (id === undefined) throw new Error(`create call ${call} had no id`);
  return id;
}

function renderSurface(surface: SurfaceCase, isFocused = true) {
  const { wrapper } = createQueryClientTestHarness();
  let watchedTerminalId = "";
  const rendered = renderHook(
    () => ({
      start: useTerminalStart(watchedTerminalId),
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
  const startFor = (terminalId: string) => {
    watchedTerminalId = terminalId;
    rendered.rerender();
    return rendered.result.current.start;
  };
  return { ...rendered, startFor };
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

  it("opens the new terminal's tab in place of the New tab page before the server responds", async () => {
    const create = deferred<TerminalSession>();
    vi.mocked(sdk.terminals.create).mockReturnValue(create.promise);
    const { result, startFor } = renderSurface(surface);
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

    const terminalId = requestedTerminalId(0);
    expect(terminalId).toMatch(/^term_/u);
    expect(sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminalId, scope: surface.createTarget }),
    );
    const startingTabs = [
      createTerminalFixedPanelTab({
        terminalId,
        target: surface.tabsCarryTarget ? surface.createTarget : undefined,
      }),
    ];
    expect(result.current.state.secondary.tabs).toEqual(startingTabs);
    expect(activeTerminalId(result.current.state)).toBe(terminalId);
    expect(startFor(terminalId)?.error).toBeNull();

    await act(async () => {
      create.resolve({ ...surface.own, id: terminalId });
      await create.promise;
    });

    await waitFor(() => expect(startFor(terminalId)).toBeNull());
    expect(result.current.state.secondary.tabs).toEqual(startingTabs);
  });

  it("keeps a failed start's tab open with the error and retries it in place under a new ID", async () => {
    vi.mocked(sdk.terminals.create).mockRejectedValueOnce(
      hostUnavailableError(),
    );
    const { result, startFor } = renderSurface(surface);
    act(() => {
      result.current.terminals.open(surface.sibling);
      result.current.terminals.start();
    });
    const terminalId = requestedTerminalId(0);

    await waitFor(() =>
      expect(startFor(terminalId)?.error).toBe("Host is not connected"),
    );
    expect(terminalTabIds(result.current.state)).toEqual([
      surface.sibling.id,
      terminalId,
    ]);
    expect(activeTerminalId(result.current.state)).toBe(terminalId);
    expect(sdk.terminals.get).not.toHaveBeenCalled();

    vi.mocked(sdk.terminals.create).mockImplementationOnce(({ id }) =>
      Promise.resolve({ ...surface.own, id: id ?? "" }),
    );
    act(() => result.current.terminals.retryStart(terminalId));

    const retriedTerminalId = requestedTerminalId(1);
    expect(retriedTerminalId).not.toBe(terminalId);
    expect(terminalTabIds(result.current.state)).toEqual([
      surface.sibling.id,
      retriedTerminalId,
    ]);
    expect(activeTerminalId(result.current.state)).toBe(retriedTerminalId);
    expect(startFor(terminalId)).toBeNull();
    await waitFor(() => expect(startFor(retriedTerminalId)).toBeNull());
  });

  it("adopts the terminal a lost create response already started", async () => {
    vi.mocked(sdk.terminals.create).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    vi.mocked(sdk.terminals.get).mockImplementation(({ terminalId }) =>
      Promise.resolve({ ...surface.own, id: terminalId }),
    );
    const { result, startFor } = renderSurface(surface);

    act(() => result.current.terminals.start());
    const terminalId = requestedTerminalId(0);

    await waitFor(() => expect(startFor(terminalId)).toBeNull());
    expect(sdk.terminals.get).toHaveBeenCalledWith({ terminalId });
    expect(terminalTabIds(result.current.state)).toEqual([terminalId]);
  });

  it("closes a starting terminal's tab at once and the terminal once it exists", async () => {
    const create = deferred<TerminalSession>();
    vi.mocked(sdk.terminals.create).mockReturnValue(create.promise);
    vi.mocked(sdk.terminals.close).mockImplementation(({ terminalId }) =>
      Promise.resolve({ ...surface.own, id: terminalId, status: "exited" }),
    );
    const { result } = renderSurface(surface);
    act(() => result.current.terminals.start());
    const terminalId = requestedTerminalId(0);

    act(() => result.current.terminals.close(terminalId));
    expect(terminalTabIds(result.current.state)).toEqual([]);
    expect(sdk.terminals.close).not.toHaveBeenCalled();

    await act(async () => {
      create.resolve({ ...surface.own, id: terminalId });
      await create.promise;
    });
    await waitFor(() =>
      expect(sdk.terminals.close).toHaveBeenCalledWith({
        mode: "force",
        terminalId,
      }),
    );
    expect(terminalTabIds(result.current.state)).toEqual([]);
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

    expect(activeTerminalId(result.current.state)).toBe(requestedTerminalId(0));
  });

  it("removes a closing terminal's tab at once, before the server confirms", async () => {
    const close = deferred<TerminalSession>();
    vi.mocked(sdk.terminals.close).mockReturnValue(close.promise);
    const { result } = renderSurface(surface);
    act(() => {
      result.current.terminals.open(surface.own);
      result.current.terminals.open(surface.sibling);
    });

    act(() => result.current.terminals.close(surface.own.id));

    expect(terminalTabIds(result.current.state)).toEqual([surface.sibling.id]);
    await waitFor(() =>
      expect(sdk.terminals.close).toHaveBeenCalledWith({
        mode: "force",
        terminalId: surface.own.id,
      }),
    );

    await act(async () => {
      close.resolve({ ...surface.own, status: "exited" });
      await close.promise;
    });
    expect(terminalTabIds(result.current.state)).toEqual([surface.sibling.id]);
  });

  it("puts the tab back in its place when closing fails, and keeps it closed when the terminal is already gone", async () => {
    vi.mocked(sdk.terminals.close).mockImplementation(({ terminalId }) =>
      Promise.reject(
        terminalId === surface.own.id
          ? hostUnavailableError()
          : new BbHttpError({
              status: 404,
              code: "terminal_not_found",
              message: "Terminal session not found",
              body: {
                code: "terminal_not_found",
                message: "Terminal session not found",
              },
            }),
      ),
    );
    const { result } = renderSurface(surface);
    act(() => {
      result.current.terminals.open(surface.own);
      result.current.terminals.open(surface.sibling);
    });

    act(() => result.current.terminals.close(surface.own.id));
    expect(terminalTabIds(result.current.state)).toEqual([surface.sibling.id]);

    await waitFor(() =>
      expect(terminalTabIds(result.current.state)).toEqual([
        surface.own.id,
        surface.sibling.id,
      ]),
    );
    expect(activeTerminalId(result.current.state)).toBe(surface.sibling.id);

    act(() => result.current.terminals.close(surface.sibling.id));
    await waitFor(() => expect(sdk.terminals.close).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(terminalTabIds(result.current.state)).toEqual([surface.own.id]);
  });

  it("reopens the panel when closing its last tab fails", async () => {
    vi.mocked(sdk.terminals.close).mockRejectedValue(hostUnavailableError());
    const { result } = renderSurface(surface);
    act(() => {
      result.current.terminals.open(surface.own);
    });

    act(() => result.current.terminals.close(surface.own.id));
    expect(result.current.state.secondary.isOpen).toBe(false);

    await waitFor(() =>
      expect(terminalTabIds(result.current.state)).toEqual([surface.own.id]),
    );
    expect(result.current.state.secondary.isOpen).toBe(true);
    expect(activeTerminalId(result.current.state)).toBe(surface.own.id);
  });
});
