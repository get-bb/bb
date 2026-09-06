import { describe, expect, it, vi } from "vitest";
import {
  BB_BROWSER_PAGE_ISOLATED_WORLD_ID,
  startDesktopBrowserPageScript,
} from "../src/desktop-browser-page-runtime.js";

class FakePageWebContents {
  public readonly calls: Array<{
    worldId: number;
    code: string;
    userGesture: boolean | undefined;
  }> = [];
  public resolve: ((value: unknown) => void) | null = null;
  public destroyed = false;
  public debuggerAttached = false;
  public registryHas = false;
  public readonly debuggerCommands: string[] = [];
  public readonly debuggerCommandSessions: Array<{
    method: string;
    sessionId: string | undefined;
  }> = [];
  public frameResolve: ((value: unknown) => void) | null = null;
  public commandGate: Promise<void> = Promise.resolve();
  public readonly debugger = {
    attach: vi.fn(() => {
      this.debuggerAttached = true;
    }),
    detach: vi.fn(() => {
      this.debuggerAttached = false;
    }),
    isAttached: vi.fn(() => this.debuggerAttached),
    sendCommand: vi.fn(
      async (
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string,
      ) => {
        this.debuggerCommands.push(method);
        this.debuggerCommandSessions.push({ method, sessionId });
        if (method === "Runtime.evaluate") {
          const expression = params?.expression;
          if (
            typeof expression === "string" &&
            expression.startsWith("(async () =>")
          ) {
            const pending = Promise.withResolvers<unknown>();
            this.frameResolve = pending.resolve;
            return pending.promise;
          }
          await this.commandGate;
          return { result: { value: this.registryHas } };
        }
      },
    ),
    commandGate: Promise.resolve(),
  };

  executeJavaScriptInIsolatedWorld(
    worldId: number,
    scripts: Array<{ code: string }>,
    userGesture?: boolean,
  ): Promise<unknown> {
    this.calls.push({ worldId, code: scripts[0]?.code ?? "", userGesture });
    if (scripts[0]?.code.startsWith("globalThis[")) {
      if (scripts[0]?.code.includes('.abort("timeout")')) {
        this.registryHas = false;
      }
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown> {
    this.calls.push({ worldId: 0, code, userGesture });
    if (code.startsWith("globalThis[")) {
      if (code.includes('.abort("timeout")')) {
        this.registryHas = false;
      }
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function request(
  overrides: Partial<{
    requestId: string;
    source: string;
    input: null | { intent: string };
    timeoutMs: number;
  }> = {},
) {
  return {
    tabId: "browser:a",
    expectedNavigationEpoch: 1,
    requestId: "req_1",
    source: "({ input }) => ({ title: document.title, input })",
    input: { intent: "inspect" },
    timeoutMs: 1_000,
    ...overrides,
  };
}
function requestWithId(requestId: string) {
  return {
    ...request(),
    requestId,
  };
}

describe("desktop Browser-page runtime", () => {
  it("runs a function in the reserved isolated world and returns bounded JSON", async () => {
    const webContents = new FakePageWebContents();
    const session = startDesktopBrowserPageScript({
      navigationEpoch: 4,
      request: request(),
      webContents,
    });

    webContents.resolve?.(
      JSON.stringify({ ok: true, value: { title: "Example" } }),
    );

    await expect(session.promise).resolves.toEqual({
      requestId: "req_1",
      navigationEpoch: 4,
      value: { title: "Example" },
    });
    expect(webContents.calls[0]).toMatchObject({
      worldId: BB_BROWSER_PAGE_ISOLATED_WORLD_ID,
      userGesture: true,
    });
    expect(webContents.calls[0]?.code).toContain("new AbortController");
    expect(
      webContents.calls[0]?.code.trimStart().startsWith("(async () =>"),
    ).toBe(true);
    expect(webContents.calls[0]?.code).not.toContain("require(");
  });

  it("uses the page main world only when a caller explicitly requests it", async () => {
    const webContents = new FakePageWebContents();
    const session = startDesktopBrowserPageScript({
      navigationEpoch: 4,
      request: { ...request(), world: "main" },
      webContents,
    });
    webContents.resolve?.(JSON.stringify({ ok: true, value: null }));
    await expect(session.promise).resolves.toMatchObject({ value: null });
    expect(webContents.calls[0]?.worldId).toBe(0);
  });

  it("cancels exactly one request and rejects immediately", async () => {
    const webContents = new FakePageWebContents();
    const session = startDesktopBrowserPageScript({
      navigationEpoch: 1,
      request: request(),
      webContents,
    });

    session.cancel();

    await expect(session.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(webContents.calls[1]?.code).toContain('get("req_1")');
  });

  it("distinguishes navigation invalidation from ordinary cancellation", async () => {
    const webContents = new FakePageWebContents();
    const session = startDesktopBrowserPageScript({
      navigationEpoch: 1,
      request: request(),
      webContents,
    });

    session.cancel("navigation");

    await expect(session.promise).rejects.toMatchObject({
      name: "NavigationError",
    });
  });

  it("enforces the main-process timeout with a scoped kill", async () => {
    vi.useFakeTimers();
    try {
      const webContents = new FakePageWebContents();
      const session = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: request({ timeoutMs: 100 }),
        webContents,
      });
      const rejection = expect(session.promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(webContents.calls[1]?.code).toContain('abort("timeout")');
      expect(webContents.debuggerCommands).toEqual([]);
      const gate: { promise: Promise<void>; resolve: () => void } = {
        promise: Promise.resolve(),
        resolve: () => undefined,
      };
      gate.promise = new Promise((resolvePromise) => {
        gate.resolve = resolvePromise;
      });
      webContents.commandGate = gate.promise;
      webContents.registryHas = true;
      vi.runOnlyPendingTimers();
      await vi.advanceTimersByTimeAsync(400);
      expect(webContents.debuggerCommands).toContain("Runtime.evaluate");
      expect(webContents.debuggerCommands).toContain(
        "Runtime.terminateExecution",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates a timed-out frame script in its own debugger session", async () => {
    vi.useFakeTimers();
    try {
      const webContents = new FakePageWebContents();
      const session = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: request({ timeoutMs: 100 }),
        webContents,
        frameContext: {
          sessionId: "child-session",
          uniqueContextId: "child-context",
        },
      });
      const rejection = expect(session.promise).rejects.toThrow("timed out");

      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      const gate = Promise.withResolvers<void>();
      webContents.commandGate = gate.promise;
      webContents.registryHas = true;
      await vi.advanceTimersByTimeAsync(600);

      expect(webContents.debuggerCommandSessions).toContainEqual({
        method: "Runtime.terminateExecution",
        sessionId: "child-session",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the scoped kill when the request already settled cooperatively", async () => {
    vi.useFakeTimers();
    try {
      const webContents = new FakePageWebContents();
      const session = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: request({ timeoutMs: 100 }),
        webContents,
      });
      const rejection = expect(session.promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      await vi.advanceTimersByTimeAsync(400);
      expect(webContents.debuggerCommands).not.toContain(
        "Runtime.terminateExecution",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the scoped kill when a newer request is outstanding", async () => {
    vi.useFakeTimers();
    try {
      const first = new FakePageWebContents();
      const firstSession = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          ...requestWithId("req_a"),
          timeoutMs: 100,
        },
        webContents: first,
      });
      const firstRejection = expect(firstSession.promise).rejects.toThrow(
        "timed out",
      );
      await vi.advanceTimersByTimeAsync(100);
      await firstRejection;

      const second = new FakePageWebContents();
      const gate: { promise: Promise<void>; resolve: () => void } = {
        promise: Promise.resolve(),
        resolve: () => undefined,
      };
      gate.promise = new Promise((resolvePromise) => {
        gate.resolve = resolvePromise;
      });
      const secondSession = startDesktopBrowserPageScript({
        navigationEpoch: 1,
        request: {
          ...requestWithId("req_b"),
          timeoutMs: 100,
        },
        webContents: second,
      });
      const secondRejection = expect(secondSession.promise).rejects.toThrow(
        "timed out",
      );
      await vi.advanceTimersByTimeAsync(100);
      await secondRejection;
      second.registryHas = true;
      second.commandGate = gate.promise;
      await vi.advanceTimersByTimeAsync(700);
      expect(second.debuggerCommands).toContain("Runtime.evaluate");
      expect(second.debuggerCommands).toContain("Runtime.terminateExecution");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid runtime envelopes and page failures", async () => {
    const invalid = new FakePageWebContents();
    const invalidSession = startDesktopBrowserPageScript({
      navigationEpoch: 1,
      request: request(),
      webContents: invalid,
    });
    invalid.resolve?.("not json");
    await expect(invalidSession.promise).rejects.toThrow("invalid JSON");

    const failed = new FakePageWebContents();
    const failedSession = startDesktopBrowserPageScript({
      navigationEpoch: 1,
      request: request(),
      webContents: failed,
    });
    failed.resolve?.(
      JSON.stringify({
        ok: false,
        error: { code: "script_failed", message: "No target" },
      }),
    );
    await expect(failedSession.promise).rejects.toThrow("No target");
  });
});
