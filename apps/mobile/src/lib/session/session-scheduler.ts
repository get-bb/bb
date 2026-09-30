import {
  fetchDesktopSession,
  type ConnectCredential,
  type DesktopSession,
} from "@bb/connect-client";
import { describeError } from "../describe-error";
import type { ConnectServerProfile } from "../profiles/profile";
import { mapAuthError } from "./auth-error";
import { installSessionCookie, type CookieStoreLike } from "./cookie-store";
import type { SessionCacheLike } from "./session-cache";

const SESSION_RENEWAL_LEAD_MS = 5 * 60 * 1000;
const SESSION_MIN_RENEWAL_DELAY_MS = 30 * 1000;
const SESSION_RETRY_DELAY_MS = 30 * 1000;

export type SessionState =
  | { status: "idle" }
  | { status: "authenticating" }
  | { status: "authenticated"; expiresAt: number }
  | { status: "auth-required"; detail: string }
  | { status: "error"; detail: string; retryAt: number };

export interface SessionSchedulerDeps {
  cookieStore: CookieStoreLike;
  sessionCache: SessionCacheLike;
  fetchSession?: (credential: ConnectCredential) => Promise<DesktopSession>;
}

export interface SessionScheduler {
  start(profile: ConnectServerProfile): Promise<SessionState>;
  renewNow(): Promise<SessionState>;
  verifySession(): Promise<SessionState>;
  renewIfDue(): void;
  stop(): void;
  getState(): SessionState;
  onStateChange(listener: (state: SessionState) => void): () => void;
}

export function createSessionScheduler(
  deps: SessionSchedulerDeps,
): SessionScheduler {
  const fetchSession = deps.fetchSession ?? fetchDesktopSession;
  const listeners = new Set<(state: SessionState) => void>();

  let generation = 0;
  let profile: ConnectServerProfile | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: { generation: number; promise: Promise<SessionState> } | null =
    null;
  let state: SessionState = { status: "idle" };

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener(next);
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleAt(at: number, startedGeneration: number): void {
    clearTimer();
    timer = setTimeout(
      () => {
        timer = null;
        if (generation !== startedGeneration) return;
        void renewNow();
      },
      Math.max(0, at - Date.now()),
    );
  }

  async function runRenewal(
    target: ConnectServerProfile,
    startedGeneration: number,
    mode: "renew" | "verify",
  ): Promise<SessionState> {
    const isCurrent = (): boolean => generation === startedGeneration;
    if (
      mode === "renew" &&
      state.status !== "authenticated" &&
      state.status !== "authenticating"
    ) {
      setState({ status: "authenticating" });
    }
    try {
      const session = await fetchSession({
        serverUrl: target.serverUrl,
        handle: target.handle,
        credential: target.credential,
      });
      if (!isCurrent()) return state;
      await installSessionCookie(deps.cookieStore, target.serverUrl, session);
      if (!isCurrent()) return state;
      const expiresAt = session.cookie.expiresAt;
      void deps.sessionCache
        .write(target.id, { serverUrl: target.serverUrl, session })
        .catch(() => undefined);
      authenticate(expiresAt, startedGeneration);
      return state;
    } catch (error) {
      if (!isCurrent()) return state;
      if (mapAuthError(error) === "auth-required") {
        void deps.sessionCache.clear(target.id).catch(() => undefined);
        clearTimer();
        setState({ status: "auth-required", detail: describeError(error) });
        return state;
      }
      if (mode === "verify") return state;
      const retryAt = Date.now() + SESSION_RETRY_DELAY_MS;
      setState({ status: "error", detail: describeError(error), retryAt });
      scheduleAt(retryAt, startedGeneration);
      return state;
    }
  }

  function authenticate(expiresAt: number, startedGeneration: number): void {
    setState({ status: "authenticated", expiresAt });
    scheduleAt(
      Math.max(
        Date.now() + SESSION_MIN_RENEWAL_DELAY_MS,
        expiresAt - SESSION_RENEWAL_LEAD_MS,
      ),
      startedGeneration,
    );
  }

  async function resumeOrMint(
    target: ConnectServerProfile,
    startedGeneration: number,
  ): Promise<SessionState> {
    const isCurrent = (): boolean => generation === startedGeneration;
    const stored = await deps.sessionCache.read(target.id).catch(() => null);
    if (!isCurrent()) return state;
    if (
      stored === null ||
      stored.serverUrl !== target.serverUrl ||
      stored.session.cookie.expiresAt - Date.now() <= SESSION_RENEWAL_LEAD_MS
    ) {
      return runRenewal(target, startedGeneration, "renew");
    }
    try {
      await installSessionCookie(
        deps.cookieStore,
        target.serverUrl,
        stored.session,
      );
    } catch {
      return isCurrent()
        ? runRenewal(target, startedGeneration, "renew")
        : state;
    }
    if (!isCurrent()) return state;
    authenticate(stored.session.cookie.expiresAt, startedGeneration);
    return state;
  }

  function track(
    run: (startedGeneration: number) => Promise<SessionState>,
  ): Promise<SessionState> {
    const startedGeneration = generation;
    const entry = {
      generation: startedGeneration,
      promise: run(startedGeneration).finally(() => {
        if (inFlight === entry) inFlight = null;
      }),
    };
    inFlight = entry;
    return entry.promise;
  }

  function mint(mode: "renew" | "verify"): Promise<SessionState> {
    const target = profile;
    if (target === null) return Promise.resolve(state);
    if (inFlight !== null && inFlight.generation === generation) {
      return inFlight.promise;
    }
    return track((startedGeneration) =>
      runRenewal(target, startedGeneration, mode),
    );
  }

  function renewNow(): Promise<SessionState> {
    return mint("renew");
  }

  function stop(): void {
    generation += 1;
    clearTimer();
    profile = null;
    setState({ status: "idle" });
  }

  return {
    start(next) {
      stop();
      profile = next;
      setState({ status: "authenticating" });
      return track((startedGeneration) =>
        resumeOrMint(next, startedGeneration),
      );
    },
    renewNow,
    verifySession() {
      if (state.status === "idle" || state.status === "auth-required") {
        return Promise.resolve(state);
      }
      return mint("verify");
    },
    renewIfDue() {
      if (profile === null) return;
      if (state.status === "error") {
        void renewNow();
        return;
      }
      if (
        state.status === "authenticated" &&
        state.expiresAt - Date.now() <= SESSION_RENEWAL_LEAD_MS
      ) {
        void renewNow();
      }
    },
    stop,
    getState: () => state,
    onStateChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
