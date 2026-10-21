import { errorText, type Log } from "./log.js";

const REFRESH_TIMEOUT_MS = 5_000;

export interface SessionRefreshOptions {
  accountAppUrl: string;
  sessionCookieName: string;
  log: Log;
  fetch?: typeof fetch;
}

export type SessionRefresher = (session: string) => Promise<string[]>;

export function createSessionRefresher(
  options: SessionRefreshOptions,
): SessionRefresher {
  const fetchImpl = options.fetch ?? fetch;
  return async (session) => {
    const url = new URL("/api/auth/get-session", options.accountAppUrl);
    url.searchParams.set("disableCookieCache", "true");
    try {
      const response = await fetchImpl(url, {
        headers: { cookie: `${options.sessionCookieName}=${session}` },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        options.log("warn", "session_refresh_refused", {
          status: response.status,
        });
        return [];
      }
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("session" in body) ||
        !("user" in body)
      ) {
        return [];
      }
      const cookies = response.headers.getSetCookie();
      options.log("info", "session_refresh", { cookies: cookies.length });
      return cookies;
    } catch (error) {
      options.log("warn", "session_refresh_failed", {
        error: errorText(error),
      });
      return [];
    }
  };
}
