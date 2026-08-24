import type { DesktopSession } from "@bb/connect-client";

/** Cookie attributes in the shape `@react-native-cookies/cookies` accepts. */
export interface SessionCookieSpec {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** ISO 8601 expiry. */
  expires: string;
}

/**
 * Native cookie jar contract. `useWebKit=false` targets the shared HTTP jar
 * (fetch, WebSocket, expo-image); `useWebKit=true` targets WKWebView's store
 * so `sharedCookiesEnabled` WebViews authenticate too. Android has one jar
 * and ignores the flag.
 */
export interface CookieStoreLike {
  set(
    url: string,
    cookie: SessionCookieSpec,
    useWebKit: boolean,
  ): Promise<unknown>;
}

/**
 * RFC 6265 §5.1.3 domain-match: `host` is `domain` itself or a subdomain of
 * it. A leading dot on `domain` is ignored, as browsers do.
 */
function cookieDomainMatches(domain: string, host: string): boolean {
  const bare = domain.replace(/^\./u, "").toLowerCase();
  return host === bare || host.endsWith(`.${bare}`);
}

/**
 * Translate the gate's session JSON into a cookie the native jar will send
 * back to `serverUrl`. `Secure` follows the server URL's scheme: the real
 * gate is https-only, but a local stub gate (e2e) may be plain http, and a
 * Secure cookie is never sent over http, which would look exactly like a
 * revoked session.
 *
 * The cookie `domain` comes from whatever server `serverUrl` points at, so
 * it is checked against that server's host before it reaches a native jar:
 * the iOS cookie manager only substring-checks the domain against the URL
 * host, which would let `bee.getbb.app.evil.example` plant a cookie for
 * `bee.getbb.app` or `.getbb.app` in the jars shared with real profiles.
 */
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
    expires: new Date(cookie.expiresAt).toISOString(),
  };
}

/** Install the desktop-session cookie in both native stores for `serverUrl`. */
export async function installSessionCookie(
  cookieStore: CookieStoreLike,
  serverUrl: string,
  session: DesktopSession,
): Promise<void> {
  const spec = sessionCookieSpec(session, serverUrl);
  await cookieStore.set(serverUrl, spec, false);
  await cookieStore.set(serverUrl, spec, true);
}
