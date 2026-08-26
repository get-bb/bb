import type { SessionState } from "../session/session-scheduler";

/**
 * What the shell screen shows, derived from the connect session and the
 * WebView's own load result. Pure, because a blank WebView is the worst
 * failure mode this screen has and the rules deserve a test.
 */

export type ShellLoadPhase =
  /** No load has started, or one is in flight. */
  | { kind: "loading" }
  /** The page posted `ready`, so it painted something the user can act on. */
  | { kind: "ready" }
  /** The WebView could not load the page at all. */
  | { kind: "failed"; detail: string }
  /** The server answered, but with an error status. */
  | { kind: "http-error"; status: number };

export type ShellScreenState =
  | { kind: "loading"; message: string }
  /** No server is paired yet. The shell cannot render a page without one. */
  | { kind: "no-profile" }
  | { kind: "webview" }
  | {
      kind: "error";
      title: string;
      detail: string;
      /** A retry reloads. `re-pair` sends the user to connect enrolment. */
      action: "retry" | "re-pair";
    };

interface ShellScreenInput {
  /** False while the profile store is still loading. */
  storeReady: boolean;
  /** Whether the phone has any saved server at all. */
  hasAnyProfile: boolean;
  /** Whether a profile is active and its URL resolved. */
  hasProfile: boolean;
  /** `idle` for a Direct profile, which needs no session. */
  session: SessionState;
  load: ShellLoadPhase;
}

/**
 * The connect session gates the load: without a valid cookie the gate answers
 * the WebView with its own sign-in page, which looks like a broken app.
 */
export function resolveShellScreenState(
  input: ShellScreenInput,
): ShellScreenState {
  if (!input.storeReady) {
    return { kind: "loading", message: "Opening server" };
  }
  // Without this the first run would spin forever behind the shell switch,
  // where the native home sends the user to the add-server screen.
  if (!input.hasAnyProfile) {
    return { kind: "no-profile" };
  }
  if (!input.hasProfile) {
    return { kind: "loading", message: "Opening server" };
  }
  switch (input.session.status) {
    case "auth-required":
      return {
        kind: "error",
        title: "This server needs pairing again",
        detail: input.session.detail,
        action: "re-pair",
      };
    case "error":
      return {
        kind: "error",
        title: "Cannot reach this server",
        detail: input.session.detail,
        action: "retry",
      };
    case "authenticating":
      return { kind: "loading", message: "Signing in" };
    case "idle":
    case "authenticated":
      break;
  }
  switch (input.load.kind) {
    case "failed":
      return {
        kind: "error",
        title: "The page did not load",
        detail: input.load.detail,
        action: "retry",
      };
    case "http-error":
      return {
        kind: "error",
        title: "The server answered with an error",
        detail: `HTTP ${input.load.status}`,
        action: "retry",
      };
    case "loading":
      // The WebView is mounted underneath and painting. Keep it in the tree
      // so its own progressive render shows through, with an overlay on top.
      return { kind: "webview" };
    case "ready":
      return { kind: "webview" };
  }
}

/**
 * Whether the WebView should be reloaded because the cookie it loaded with is
 * no longer the cookie the app holds. A resume after a long sleep re-mints,
 * and the page's next request would otherwise 401 into a gate sign-in page.
 */
export function shouldReloadForSession(
  previous: SessionState,
  next: SessionState,
): boolean {
  if (next.status !== "authenticated") return false;
  if (previous.status !== "authenticated") return true;
  return previous.expiresAt !== next.expiresAt;
}
