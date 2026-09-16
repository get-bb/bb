// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type KeyboardCommandId } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { ThreadHistoryCommandHandlers } from "./ThreadHistoryCommandHandlers";

const mocks = vi.hoisted(() => ({
  closeMobileSidebar: vi.fn(),
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

const harness: {
  runner: AppCommandRunner | null;
  navigate: NavigateFunction | null;
} = { runner: null, navigate: null };

function Harness({ enabled }: { enabled: boolean }) {
  const runner = useAppCommandRunner();
  const navigate = useNavigate();
  useEffect(() => {
    harness.runner = runner;
    harness.navigate = navigate;
  }, [navigate, runner]);
  return (
    <>
      <ThreadHistoryCommandHandlers enabled={enabled} />
      <span data-testid="location">{useLocation().pathname}</span>
    </>
  );
}

function renderAt(
  pathname: string,
  { store = createStore(), enabled = true } = {},
) {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[pathname]}>
        <AppCommandProvider>
          <Harness enabled={enabled} />
        </AppCommandProvider>
      </MemoryRouter>
    </Provider>,
  );
  return store;
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

function currentPath() {
  return screen.getByTestId("location").textContent;
}

describe("ThreadHistoryCommandHandlers", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.closeMobileSidebar.mockClear();
  });

  afterEach(() => {
    cleanup();
    harness.runner = null;
    harness.navigate = null;
  });

  it("steps back and forward through the threads opened in this window", () => {
    renderAt("/projects/proj_1/threads/thr_a");
    open("/projects/proj_1/threads/thr_b");
    open("/projects/proj_2/threads/thr_c");

    expect(dispatch("thread.previous")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_b");
    expect(mocks.closeMobileSidebar).toHaveBeenCalledTimes(1);

    expect(dispatch("thread.previous")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_a");

    expect(dispatch("thread.next")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_b");

    expect(dispatch("thread.next")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_2/threads/thr_c");
  });

  it("leaves the route alone when there is nothing to go back or forward to", () => {
    renderAt("/projects/proj_1/threads/thr_a");

    expect(dispatch("thread.previous")).toBe(false);
    expect(dispatch("thread.next")).toBe(false);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_a");
    expect(mocks.closeMobileSidebar).not.toHaveBeenCalled();
  });

  it("drops forward history when a different thread is opened after going back", () => {
    renderAt("/projects/proj_1/threads/thr_a");
    open("/projects/proj_1/threads/thr_b");
    dispatch("thread.previous");
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_a");

    open("/projects/proj_1/threads/thr_c");

    expect(dispatch("thread.next")).toBe(false);
    expect(dispatch("thread.previous")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_a");
    expect(dispatch("thread.next")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_c");
  });

  it("skips non-thread routes and returns to projectless threads by their own path", () => {
    renderAt("/threads/thr_personal");
    open("/settings");
    open("/projects/proj_1/threads/thr_b");

    expect(dispatch("thread.previous")).toBe(true);
    expect(currentPath()).toBe("/threads/thr_personal");
  });

  it("keeps recording visits but ignores the commands while disabled", () => {
    const store = renderAt("/projects/proj_1/threads/thr_a", {
      enabled: false,
    });
    open("/projects/proj_1/threads/thr_b");

    expect(dispatch("thread.previous")).toBe(false);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_b");

    cleanup();
    renderAt("/projects/proj_1/threads/thr_b", { store });
    expect(dispatch("thread.previous")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_a");
  });

  it("restores the history for this window after a reload", () => {
    renderAt("/projects/proj_1/threads/thr_a");
    open("/projects/proj_1/threads/thr_b");
    cleanup();

    renderAt("/projects/proj_1/threads/thr_b", { store: createStore() });

    expect(dispatch("thread.previous")).toBe(true);
    expect(currentPath()).toBe("/projects/proj_1/threads/thr_a");
  });
});
