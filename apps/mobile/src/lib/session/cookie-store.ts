import type { DesktopSession } from "@bb/connect-client";
import type { DirectServerAccess } from "../profiles/profile";

const DIRECT_ACCESS_COOKIE_LIFETIME_MS = 400 * 24 * 60 * 60 * 1000;

export interface SessionCookieSpec {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: string;
}

export interface CookieStoreLike {
  set(
    url: string,
    cookie: SessionCookieSpec,
    useWebKit: boolean,
  ): Promise<unknown>;
}

function cookieDomainMatches(domain: string, host: string): boolean {
  const bare = domain.replace(/^\./u, "").toLowerCase();
  return host === bare || host.endsWith(`.${bare}`);
}

export function sessionCookieSpec(
  session: DesktopSession,
  serverUrl: string,
): SessionCookieSpec {
  const { cookie } = session;
  const url = new URL(serverUrl);
  if (!cookieDomainMatches(cookie.domain, url.hostname)) {
    throw new Error(
      `Desktop-session cookie domain ${cookie.domain} does not match ${url.hostname}`,
    );
  }
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: "/",
    secure: url.protocol === "https:",
    httpOnly: true,
    expires: cookieExpiry(cookie.expiresAt),
  };
}

function cookieExpiry(at: number): string {
  return new Date(at).toISOString().replace(/Z$/u, "+00:00");
}

export function directAccessCookieSpec(
  access: DirectServerAccess,
  serverUrl: string,
  now: number,
): SessionCookieSpec {
  const url = new URL(serverUrl);
  return {
    name: access.cookieName,
    value: access.token,
    domain: url.hostname,
    path: "/",
    secure: url.protocol === "https:",
    httpOnly: true,
    expires: cookieExpiry(now + DIRECT_ACCESS_COOKIE_LIFETIME_MS),
  };
}

async function installCookieSpec(
  cookieStore: CookieStoreLike,
  serverUrl: string,
  spec: SessionCookieSpec,
): Promise<void> {
  await cookieStore.set(serverUrl, spec, false);
  await cookieStore.set(serverUrl, spec, true);
}

export async function installSessionCookie(
  cookieStore: CookieStoreLike,
  serverUrl: string,
  session: DesktopSession,
): Promise<void> {
  await installCookieSpec(
    cookieStore,
    serverUrl,
    sessionCookieSpec(session, serverUrl),
  );
}

export async function installDirectAccessCookie(
  cookieStore: CookieStoreLike,
  serverUrl: string,
  access: DirectServerAccess,
): Promise<void> {
  await installCookieSpec(
    cookieStore,
    serverUrl,
    directAccessCookieSpec(access, serverUrl, Date.now()),
  );
}
