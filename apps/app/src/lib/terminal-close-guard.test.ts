// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { BbDesktopApi } from "@bb/desktop-contract";
import type { TerminalSession } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasActiveTerminalSession,
  isActiveTerminalSessionForCloseGuard,
  resetTerminalCloseGuardForTest,
  setTerminalSessionActive,
  useBeforeUnloadGuard,
  useHasActiveTerminalSession,
  useRegisterActiveTerminalSession,
} from "./terminal-close-guard";

function makeSession(
  id: string,
  status: TerminalSession["status"],
): TerminalSession {
  return { id, status } as TerminalSession;
}

afterEach(() => {
  resetTerminalCloseGuardForTest();
  window.bbDesktop = undefined;
  vi.restoreAllMocks();
});

describe("isActiveTerminalSessionForCloseGuard", () => {
  it("returns true for running and disconnected sessions", () => {
    expect(isActiveTerminalSessionForCloseGuard("running")).toBe(true);
    expect(isActiveTerminalSessionForCloseGuard("disconnected")).toBe(true);
  });

  it("returns false for starting and exited sessions", () => {
    expect(isActiveTerminalSessionForCloseGuard("starting")).toBe(false);
    expect(isActiveTerminalSessionForCloseGuard("exited")).toBe(false);
  });
});

describe("active terminal session tracking", () => {
  it("starts with no active sessions", () => {
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("reports active after registering a session", () => {
    setTerminalSessionActive("session-1", true);
    expect(hasActiveTerminalSession()).toBe(true);
  });

  it("reports inactive after unregistering a session", () => {
    setTerminalSessionActive("session-1", true);
    setTerminalSessionActive("session-1", false);
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("stays active while any session is active", () => {
    setTerminalSessionActive("session-1", true);
    setTerminalSessionActive("session-2", true);
    setTerminalSessionActive("session-1", false);
    expect(hasActiveTerminalSession()).toBe(true);
    setTerminalSessionActive("session-2", false);
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("supports the same session registered from multiple panels", () => {
    setTerminalSessionActive("session-1", true);
    setTerminalSessionActive("session-1", true);
    setTerminalSessionActive("session-1", false);
    expect(hasActiveTerminalSession()).toBe(true);
    setTerminalSessionActive("session-1", false);
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("ignores unregistering a session that was never registered", () => {
    setTerminalSessionActive("session-1", false);
    expect(hasActiveTerminalSession()).toBe(false);
  });
});

describe("useHasActiveTerminalSession", () => {
  it("reflects registration changes", () => {
    const { result } = renderHook(() => useHasActiveTerminalSession());
    expect(result.current).toBe(false);
    act(() => {
      setTerminalSessionActive("session-1", true);
    });
    expect(result.current).toBe(true);
    act(() => {
      setTerminalSessionActive("session-1", false);
    });
    expect(result.current).toBe(false);
  });
});

describe("useRegisterActiveTerminalSession", () => {
  it("registers an active session", () => {
    renderHook(() =>
      useRegisterActiveTerminalSession(makeSession("s1", "running")),
    );
    expect(hasActiveTerminalSession()).toBe(true);
  });

  it("does not register a non-active session", () => {
    renderHook(() =>
      useRegisterActiveTerminalSession(makeSession("s1", "exited")),
    );
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("does not register when the session is null", () => {
    renderHook(() => useRegisterActiveTerminalSession(null));
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("unregisters on unmount", () => {
    const { unmount } = renderHook(() =>
      useRegisterActiveTerminalSession(makeSession("s1", "running")),
    );
    expect(hasActiveTerminalSession()).toBe(true);
    unmount();
    expect(hasActiveTerminalSession()).toBe(false);
  });

  it("updates when the session status changes", () => {
    const { rerender } = renderHook(
      (session: TerminalSession | null) =>
        useRegisterActiveTerminalSession(session),
      { initialProps: makeSession("s1", "running") },
    );
    expect(hasActiveTerminalSession()).toBe(true);
    rerender(makeSession("s1", "exited"));
    expect(hasActiveTerminalSession()).toBe(false);
  });
});

describe("useBeforeUnloadGuard", () => {
  it("registers a beforeunload listener when a terminal is active in the browser", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    setTerminalSessionActive("session-1", true);
    const { unmount } = renderHook(() => useBeforeUnloadGuard());
    expect(addEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("does not register a beforeunload listener without an active terminal", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    renderHook(() => useBeforeUnloadGuard());
    expect(addEventListener).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("registers the listener when a terminal becomes active after mount", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    renderHook(() => useBeforeUnloadGuard());
    expect(addEventListener).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    act(() => {
      setTerminalSessionActive("session-1", true);
    });
    expect(addEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("does not register a beforeunload listener in the desktop app", () => {
    window.bbDesktop = {} as BbDesktopApi;
    const addEventListener = vi.spyOn(window, "addEventListener");
    setTerminalSessionActive("session-1", true);
    renderHook(() => useBeforeUnloadGuard());
    expect(addEventListener).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("requests unload confirmation with both modern and legacy mechanisms", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    setTerminalSessionActive("session-1", true);
    renderHook(() => useBeforeUnloadGuard());
    const handler = addEventListener.mock.calls.find(
      ([type]) => type === "beforeunload",
    )?.[1] as ((event: BeforeUnloadEvent) => void) | undefined;
    expect(handler).toBeTypeOf("function");
    const event = {
      preventDefault: vi.fn(),
      returnValue: "",
    } as unknown as BeforeUnloadEvent;
    handler?.(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("true");
  });
});
