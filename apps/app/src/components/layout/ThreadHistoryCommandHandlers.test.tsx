// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type ChangedMessage,
  type KeyboardCommandId,
} from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import {
  AppCommandProvider,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { getDefaultStore } from "jotai";
import { appQueryClient } from "@/lib/app-query-client";
import {
  EMPTY_THREAD_NAVIGATION_HISTORY,
  threadNavigationHistoryAtom,
} from "@/lib/thread-navigation-history";
import { ThreadHistoryCommandHandlers } from "./ThreadHistoryCommandHandlers";

const mocks = vi.hoisted(() => ({
  closeMobileSidebar: vi.fn(),
  changeListeners: new Set<(message: ChangedMessage) => void>(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { ...defaultAppSettings }, keybindings: [] },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useCloseMobileSidebar: () => mocks.closeMobileSidebar,
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    onChanged: (callback: (message: ChangedMessage) => void) => {
      mocks.changeListeners.add(callback);
      return () => {
        mocks.changeListeners.delete(callback);
      };
    },
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

const harness: {
  runner: AppCommandRunner | null;
  navigate: NavigateFunction | null;
} = { runner: null, navigate: null };

function Harness() {
  const runner = useAppCommandRunner();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    harness.runner = runner;
    harness.navigate = navigate;
  }, [navigate, runner]);
  return (
    <>
      <ThreadHistoryCommandHandlers />
      <span data-testid="location">{location.pathname}</span>
    </>
  );
}

function renderAt(pathname: string): QueryClient {
  render(
    <QueryClientProvider client={appQueryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <AppCommandProvider>
          <Harness />
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return appQueryClient;
}

function open(pathname: string) {
  act(() => {
    void harness.navigate?.(pathname);
  });
}

function dispatch(command: KeyboardCommandId): boolean {
  let handled = false;
  act(() => {
    handled = harness.runner?.dispatch(command, null) ?? false;
  });
  return handled;
}

function emit(message: ChangedMessage) {
  act(() => {
    for (const listener of mocks.changeListeners) listener(message);
  });
}

function currentPath() {
  return screen.getByTestId("location").textContent;
}

const A = "/projects/proj_1/threads/thr_a";
const B = "/projects/proj_1/threads/thr_b";
const C = "/projects/proj_2/threads/thr_c";
const D = "/projects/proj_1/threads/thr_d";

describe("ThreadHistoryCommandHandlers", () => {
  beforeEach(() => {
    mocks.closeMobileSidebar.mockClear();
  });

  afterEach(() => {
    cleanup();
    mocks.changeListeners.clear();
    harness.runner = null;
    harness.navigate = null;
    appQueryClient.clear();
    getDefaultStore().set(
      threadNavigationHistoryAtom,
      EMPTY_THREAD_NAVIGATION_HISTORY,
    );
  });

  it("navigates back and forward and closes the mobile sidebar", () => {
    renderAt(A);
    open(B);

    expect(dispatch("thread.forward")).toBe(false);
    expect(mocks.closeMobileSidebar).not.toHaveBeenCalled();

    expect(dispatch("thread.back")).toBe(true);
    expect(currentPath()).toBe(A);
    expect(mocks.closeMobileSidebar).toHaveBeenCalledTimes(1);

    expect(dispatch("thread.forward")).toBe(true);
    expect(currentPath()).toBe(B);
  });

  it("leaves pages out of the history and returns to projectless threads", () => {
    renderAt("/threads/thr_personal");
    open("/settings");
    open(B);

    expect(dispatch("thread.back")).toBe(true);
    expect(currentPath()).toBe("/threads/thr_personal");
  });

  it("skips threads the cache already knows were deleted", () => {
    const queryClient = renderAt(A);
    open(B);
    open(C);
    open(D);
    act(() => {
      queryClient.setQueryData(
        threadQueryKey("thr_c"),
        makeThreadResponse({ id: "thr_c", deletedAt: 1 }),
      );
      const missing = queryClient
        .getQueryCache()
        .build(queryClient, { queryKey: threadQueryKey("thr_b") });
      missing.setState({
        ...missing.state,
        status: "error",
        error: new BbHttpError({
          body: null,
          code: null,
          message: "Missing",
          status: 404,
        }),
      });
    });

    expect(dispatch("thread.back")).toBe(true);
    expect(currentPath()).toBe(A);
  });

  it("opens archived threads normally", () => {
    const queryClient = renderAt(A);
    open(B);
    act(() => {
      queryClient.setQueryData(
        threadQueryKey("thr_a"),
        makeThreadResponse({ id: "thr_a", archivedAt: 1 }),
      );
    });

    expect(dispatch("thread.back")).toBe(true);
    expect(currentPath()).toBe(A);
  });

  it("forgets threads and projects deleted while the window is open", () => {
    renderAt(A);
    open(B);
    open(C);
    open(D);

    emit({
      type: "changed",
      entity: "project",
      id: "proj_2",
      changes: ["project-deleted"],
    });
    emit({
      type: "changed",
      entity: "thread",
      id: "thr_b",
      changes: ["thread-deleted"],
    });

    expect(dispatch("thread.back")).toBe(true);
    expect(currentPath()).toBe(A);
    expect(dispatch("thread.forward")).toBe(true);
    expect(currentPath()).toBe(D);
  });
});
