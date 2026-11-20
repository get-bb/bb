import { isLoopbackHostname } from "@bb/config/loopback";
import { readLocalAccessTokenSync } from "@bb/config/local-access-token";
import { z } from "zod";

export interface SessionCookieJar {
  get(filter: {
    name: string;
    url: string;
  }): Promise<readonly { name: string; value: string }[]>;
  set(details: {
    expirationDate: number;
    httpOnly: boolean;
    name: string;
    path: string;
    sameSite: "lax";
    secure: boolean;
    url: string;
    value: string;
  }): Promise<void>;
}

export type LocalServerFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const SESSION_COOKIE_LIFETIME_MS = 400 * 24 * 60 * 60_000;

const sessionStateSchema = z.object({ authenticated: z.boolean() });

const localSessionSchema = z.object({
  token: z.string().min(1),
  cookieName: z.string().min(1),
  expiresAt: z.number().int(),
});

export type LocalBrowserSessionResult =
  | { kind: "existing" }
  | { kind: "installed"; expiresAt: number }
  | { kind: "no-token" }
  | { kind: "failed"; detail: string };

function sameLoopbackOrigin(target: string, serverUrl: string): boolean {
  let targetUrl: URL;
  let server: URL;
  try {
    targetUrl = new URL(target);
    server = new URL(serverUrl);
  } catch {
    return false;
  }
  return (
    targetUrl.origin === server.origin && isLoopbackHostname(targetUrl.hostname)
  );
}

export function readLocalServerAuthorization(
  dataDir: string | null,
): string | null {
  if (dataDir === null) return null;
  const token = readLocalAccessTokenSync(dataDir);
  return token === null ? null : `Bearer ${token}`;
}

export function localServerAuthorizationFor(
  target: string,
  args: { serverUrl: string; readAuthorization: () => string | null },
): string | null {
  return sameLoopbackOrigin(target, args.serverUrl)
    ? args.readAuthorization()
    : null;
}

export function createLocalServerFetch(args: {
  fetchImpl: typeof fetch;
  readAuthorization: () => string | null;
  serverUrl: () => string;
}): typeof fetch {
  return (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    const authorization = localServerAuthorizationFor(target, {
      readAuthorization: args.readAuthorization,
      serverUrl: args.serverUrl(),
    });
    if (authorization === null) return args.fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set("authorization", authorization);
    return args.fetchImpl(input, { ...init, headers });
  };
}

export function localSessionCookieName(serverUrl: string): string {
  const url = new URL(serverUrl);
  const port =
    url.port.length > 0 ? url.port : url.protocol === "https:" ? "443" : "80";
  return `bb_session_${port}`;
}

function cookieUrls(serverUrl: string, windowUrl: string): string[] {
  const server = new URL(serverUrl).origin;
  const window = new URL(windowUrl).origin;
  return server === window ? [server] : [server, window];
}

export async function ensureLocalBrowserSession(args: {
  cookieJar: SessionCookieJar;
  fetchImpl: LocalServerFetch;
  label: string;
  now: () => number;
  readAuthorization: () => string | null;
  serverUrl: string;
  windowUrl: string;
}): Promise<LocalBrowserSessionResult> {
  const base = args.serverUrl.replace(/\/+$/u, "");
  const cookieName = localSessionCookieName(args.serverUrl);
  const existing = (
    await args.cookieJar.get({ name: cookieName, url: base })
  ).find((cookie) => cookie.name === cookieName);
  if (existing !== undefined) {
    try {
      const response = await args.fetchImpl(`${base}/api/v1/access/session`, {
        headers: { cookie: `${cookieName}=${existing.value}` },
      });
      const parsed = sessionStateSchema.safeParse(await response.json());
      if (parsed.success && parsed.data.authenticated) {
        return { kind: "existing" };
      }
    } catch (error) {
      return {
        kind: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const authorization = args.readAuthorization();
  if (authorization === null) return { kind: "no-token" };
  let minted: z.infer<typeof localSessionSchema>;
  try {
    const response = await args.fetchImpl(
      `${base}/api/v1/access/local-sessions`,
      {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: args.label }),
      },
    );
    if (!response.ok) {
      return { kind: "failed", detail: `HTTP ${response.status}` };
    }
    const parsed = localSessionSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { kind: "failed", detail: "unexpected local session response" };
    }
    minted = parsed.data;
  } catch (error) {
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  for (const url of cookieUrls(args.serverUrl, args.windowUrl)) {
    await args.cookieJar.set({
      expirationDate: (args.now() + SESSION_COOKIE_LIFETIME_MS) / 1000,
      httpOnly: true,
      name: minted.cookieName,
      path: "/",
      sameSite: "lax",
      secure: false,
      url,
      value: minted.token,
    });
  }
  return { kind: "installed", expiresAt: minted.expiresAt };
}
