// @vitest-environment jsdom

import { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppDefaultKeybinding,
  type KeyboardCommandId,
} from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import { resetAppRouteHistoryForTest } from "@/lib/app-route-history";
import { browserPlatform, presentAppShortcut } from "@/lib/app-keybindings";
import { HistoryCommandHandlers } from "./HistoryCommandHandlers";

const mocks = vi.hoisted(() => {
  function webBinding(
    command: "history.back" | "history.forward",
    key: string,
  ): AppDefaultKeybinding {
    return {
      command,
      desktopOnly: false,
      shortcut: {
        key,
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface"], none: [] },
    };
  }
  return {
    backBinding: webBinding("history.back", "["),
    forwardBinding: webBinding("history.forward", "]"),
    closeMobileSidebar: vi.fn(),
  };
});

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: [mocks.backBinding, mocks.forwardBinding],
    },
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
      <HistoryCommandHandlers />
      <SidebarHistoryNavigationControls />
      <span data-testid="location">{location.pathname}</span>
    </>
  );
}

function renderAt(pathname: string) {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppCommandProvider>
        <Harness />
      </AppCommandProvider>
    </MemoryRouter>,
  );
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

async function expectPath(pathname: string) {
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe(pathname),
  );
}

const A = "/projects/proj_1/threads/thr_a";
const B = "/settings";

describe("HistoryCommandHandlers", () => {
  beforeEach(() => {
    mocks.closeMobileSidebar.mockClear();
  });

  afterEach(() => {
    cleanup();
    harness.runner = null;
    harness.navigate = null;
    resetAppRouteHistoryForTest();
  });

  it("moves through the sidebar's route history and closes the mobile sidebar", async () => {
    renderAt(A);

    expect(dispatch("history.back")).toBe(false);
    expect(dispatch("history.forward")).toBe(false);
    expect(mocks.closeMobileSidebar).not.toHaveBeenCalled();

    open(B);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Go back" })
          .getAttribute("aria-disabled") === "true",
      ).toBe(false),
    );

    expect(dispatch("history.back")).toBe(true);
    await expectPath(A);
    expect(mocks.closeMobileSidebar).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Go forward" })
          .getAttribute("aria-disabled") === "true",
      ).toBe(false),
    );
    expect(dispatch("history.back")).toBe(false);

    expect(dispatch("history.forward")).toBe(true);
    await expectPath(B);
    expect(mocks.closeMobileSidebar).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Go forward" })
          .getAttribute("aria-disabled") === "true",
      ).toBe(true),
    );
    expect(dispatch("history.forward")).toBe(false);
  });

  it("shows each sidebar arrow's shortcut in its tooltip", async () => {
    renderAt(A);
    open(B);
    const back = screen.getByRole("button", { name: "Go back" });
    const forward = screen.getByRole("button", { name: "Go forward" });
    const backDefinition = mocks.backBinding.shortcut;
    const forwardDefinition = mocks.forwardBinding.shortcut;
    if (backDefinition === null || forwardDefinition === null) {
      throw new Error("Expected default shortcuts for history commands");
    }
    const backShortcut = presentAppShortcut(backDefinition, browserPlatform());
    const forwardShortcut = presentAppShortcut(
      forwardDefinition,
      browserPlatform(),
    );

    expect(back.getAttribute("aria-keyshortcuts")).toBe(
      backShortcut.ariaKeyshortcuts,
    );
    expect(forward.getAttribute("aria-keyshortcuts")).toBe(
      forwardShortcut.ariaKeyshortcuts,
    );

    await waitFor(() => expect(back.getAttribute("aria-disabled") === "true").toBe(false));
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(back);

    await waitFor(() => {
      const [tooltip] = screen.queryAllByRole("tooltip");
      expect(tooltip?.textContent?.trim()).toBe(backShortcut.label);
      expect(tooltip?.querySelector("kbd")?.textContent).toBe(
        backShortcut.label,
      );
    });
  });

  it("shows both shortcuts beside the arrows while the modifier is held", async () => {
    const platform = vi
      .spyOn(navigator, "platform", "get")
      .mockReturnValue("MacIntel");
    renderAt(A);
    const hints = () =>
      document.querySelectorAll("[data-sidebar-history-shortcut-hints] kbd");
    expect(hints()).toHaveLength(0);
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    await waitFor(() => expect(hints()).toHaveLength(2), { timeout: 2000 });
    fireEvent.keyUp(window, { key: "Meta" });
    await waitFor(() => expect(hints()).toHaveLength(0));
    platform.mockRestore();
  });
});
