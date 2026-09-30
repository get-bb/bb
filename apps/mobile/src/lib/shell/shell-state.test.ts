import { describe, expect, it } from "vitest";
import type { SessionState } from "../session/session-scheduler";
import {
  resolveShellLoadPath,
  resolveShellScreenState,
  shouldReloadForSession,
  type ShellLoadPhase,
} from "./shell-state";

const READY: ShellLoadPhase = { kind: "ready" };
const IDLE: SessionState = { status: "idle" };
const AUTHENTICATED: SessionState = {
  status: "authenticated",
  expiresAt: 1_000,
};

const BASE = { storeReady: true, hasAnyProfile: true, requiresSession: false };

describe("resolveShellScreenState", () => {
  it("sends a phone with no server to the add-server screen", () => {
    expect(
      resolveShellScreenState({
        storeReady: true,
        hasAnyProfile: false,
        hasProfile: false,
        requiresSession: false,
        session: IDLE,
        load: { kind: "loading" },
      }),
    ).toEqual({ kind: "no-profile" });
  });

  it("waits for the profile store before deciding anything", () => {
    expect(
      resolveShellScreenState({
        storeReady: false,
        hasAnyProfile: false,
        hasProfile: false,
        requiresSession: false,
        session: IDLE,
        load: { kind: "loading" },
      }).kind,
    ).toBe("loading");
  });
  it("keeps a bb connect profile off the page until its session starts", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        requiresSession: true,
        session: IDLE,
        load: { kind: "loading" },
      }),
    ).toEqual({ kind: "loading", message: "Signing in" });
  });

  it("shows the page once a Direct profile is loaded", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        session: IDLE,
        load: READY,
      }),
    ).toEqual({ kind: "webview", serverErrorStatus: null });
  });

  it("asks for re-pairing when the gate rejected the credential", () => {
    const state = resolveShellScreenState({
      ...BASE,
      hasProfile: true,
      session: { status: "auth-required", detail: "credential revoked" },
      load: READY,
    });
    expect(state).toEqual({
      kind: "error",
      title: "Could not sign in",
      detail:
        "bb connect could not renew this phone’s sign-in. Pair again to reconnect.",
      action: "re-pair",
    });
  });

  it("puts the session error ahead of any load result", () => {
    const state = resolveShellScreenState({
      ...BASE,
      hasProfile: true,
      session: { status: "error", detail: "offline", retryAt: 0 },
      load: READY,
    });
    expect(state.kind).toBe("error");
    if (state.kind !== "error") throw new Error("unreachable");
    expect(state.action).toBe("retry");
  });

  it("reports a failed load with a retry", () => {
    const state = resolveShellScreenState({
      ...BASE,
      hasProfile: true,
      session: AUTHENTICATED,
      load: { kind: "failed", detail: "The network connection was lost." },
    });
    expect(state).toEqual({
      kind: "error",
      title: "The page did not load",
      detail: "The network connection was lost.",
      action: "retry",
    });
  });

  it("shows the server's own error page instead of replacing it", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        session: AUTHENTICATED,
        load: { kind: "http-error", status: 503 },
      }),
    ).toEqual({ kind: "webview", serverErrorStatus: 503 });
  });

  it("keeps the WebView mounted while a load is in flight", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        session: AUTHENTICATED,
        load: { kind: "loading" },
      }),
    ).toEqual({ kind: "webview", serverErrorStatus: null });
  });

  it("waits for the profile and for the first session mint", () => {
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: false,
        session: IDLE,
        load: { kind: "loading" },
      }).kind,
    ).toBe("loading");
    expect(
      resolveShellScreenState({
        ...BASE,
        hasProfile: true,
        session: { status: "authenticating" },
        load: { kind: "loading" },
      }).kind,
    ).toBe("loading");
  });
});

describe("resolveShellLoadPath", () => {
  it("reloads the page where the user is, not where it was first opened", () => {
    expect(
      resolveShellLoadPath({
        visitedPath: "/projects/p1/threads/thr_new",
        requestedPath: "/projects/p1/threads/thr_notified",
      }),
    ).toBe("/projects/p1/threads/thr_new");
  });

  it("opens a requested thread before the page reports where it is", () => {
    expect(
      resolveShellLoadPath({
        visitedPath: null,
        requestedPath: "/projects/p1/threads/thr_notified",
      }),
    ).toBe("/projects/p1/threads/thr_notified");
  });

  it("opens the new-thread page on a cold start", () => {
    expect(
      resolveShellLoadPath({ visitedPath: null, requestedPath: undefined }),
    ).toBe("/");
    expect(resolveShellLoadPath({ visitedPath: null, requestedPath: "" })).toBe(
      "/",
    );
  });
});

describe("shouldReloadForSession", () => {
  const RENEWED: SessionState = { status: "authenticated", expiresAt: 2_000 };

  it("reloads when the cookie the page loaded with has expired", () => {
    expect(shouldReloadForSession(AUTHENTICATED, RENEWED, 1_000)).toBe(true);
    expect(shouldReloadForSession(AUTHENTICATED, RENEWED, 1_500)).toBe(true);
  });

  it("does not reload when a renewal replaces a cookie that is still valid", () => {
    expect(shouldReloadForSession(AUTHENTICATED, RENEWED, 999)).toBe(false);
  });

  it("does not reload on the first mint, since the page only mounts after it", () => {
    expect(
      shouldReloadForSession({ status: "authenticating" }, AUTHENTICATED, 0),
    ).toBe(false);
    expect(shouldReloadForSession(IDLE, AUTHENTICATED, 0)).toBe(false);
  });

  it("does not reload on an unchanged session or a failure", () => {
    expect(shouldReloadForSession(AUTHENTICATED, AUTHENTICATED, 5_000)).toBe(
      false,
    );
    expect(
      shouldReloadForSession(
        AUTHENTICATED,
        { status: "error", detail: "offline", retryAt: 0 },
        5_000,
      ),
    ).toBe(false);
    expect(shouldReloadForSession(IDLE, IDLE, 5_000)).toBe(false);
  });
});
