import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalServerFetch,
  ensureLocalBrowserSession,
  readLocalServerAuthorization,
  type LocalServerFetch,
  type SessionCookieJar,
} from "../src/local-server-access.js";

const directories: string[] = [];

afterEach(async () => {
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

interface SetCookie {
  name: string;
  value: string;
  url: string;
  httpOnly: boolean;
  secure: boolean;
}

function memoryCookieJar(
  initial: Record<string, string> = {},
): SessionCookieJar & { sets: SetCookie[] } {
  const values = new Map(Object.entries(initial));
  const sets: SetCookie[] = [];
  return {
    sets,
    async get({ name }) {
      const value = values.get(name);
      return value === undefined ? [] : [{ name, value }];
    },
    async set(details) {
      values.set(details.name, details.value);
      sets.push({
        name: details.name,
        value: details.value,
        url: details.url,
        httpOnly: details.httpOnly,
        secure: details.secure,
      });
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("local server token", () => {
  it("reads the server's 0600 token file as a bearer and is absent without one", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-desktop-local-"));
    directories.push(dataDir);
    expect(readLocalServerAuthorization(dataDir)).toBeNull();
    await writeFile(join(dataDir, "local-access-token"), "secret\n");
    expect(readLocalServerAuthorization(dataDir)).toBe("Bearer bbl_secret");
    expect(readLocalServerAuthorization(null)).toBeNull();
  });

  it("sends the token only to the local server's own loopback origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("ok"));
    const localFetch = createLocalServerFetch({
      fetchImpl,
      readAuthorization: () => "Bearer bbl_secret",
      serverUrl: () => "http://127.0.0.1:38886",
    });
    for (const url of [
      "http://127.0.0.1:38886/api/v1/system/config",
      "http://127.0.0.1:4000/api/v1/system/config",
      "https://bee.getbb.app/api/v1/system/config",
      "http://192.168.1.5:38886/api/v1/system/config",
    ]) {
      await localFetch(url);
    }
    const sent = fetchImpl.mock.calls.map(([url, init]) => [
      url,
      new Headers(init?.headers).get("authorization"),
    ]);
    expect(sent).toEqual([
      ["http://127.0.0.1:38886/api/v1/system/config", "Bearer bbl_secret"],
      ["http://127.0.0.1:4000/api/v1/system/config", null],
      ["https://bee.getbb.app/api/v1/system/config", null],
      ["http://192.168.1.5:38886/api/v1/system/config", null],
    ]);
  });

  it("never sends the token to a LAN server even when it is the configured local URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("ok"));
    const localFetch = createLocalServerFetch({
      fetchImpl,
      readAuthorization: () => "Bearer bbl_secret",
      serverUrl: () => "http://192.168.1.5:38886",
    });
    await localFetch("http://192.168.1.5:38886/api/v1/system/config");
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBeNull();
  });
});

describe("ensureLocalBrowserSession", () => {
  it("keeps a cookie the server still accepts and mints nothing", async () => {
    const jar = memoryCookieJar({ bb_session_38886: "bbs_live" });
    const fetchImpl = vi.fn<LocalServerFetch>(async () =>
      json({ authenticated: true }),
    );
    const result = await ensureLocalBrowserSession({
      cookieJar: jar,
      fetchImpl,
      label: "bb desktop on mac",
      now: () => 0,
      readAuthorization: () => "Bearer bbl_secret",
      serverUrl: "http://127.0.0.1:38886",
      windowUrl: "http://127.0.0.1:38886/",
    });
    expect(result).toEqual({ kind: "existing" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("cookie"),
    ).toBe("bb_session_38886=bbs_live");
  });

  it("replaces a stale cookie with a local session minted by the token, on both the server and dev window origins", async () => {
    const jar = memoryCookieJar({ bb_session_38886: "bbs_revoked" });
    const fetchImpl = vi.fn<LocalServerFetch>(async (url) =>
      url.endsWith("/api/v1/access/session")
        ? json({ authenticated: false })
        : json({
            token: "bbs_new",
            cookieName: "bb_session_38886",
            expiresAt: 1_000,
          }),
    );
    const result = await ensureLocalBrowserSession({
      cookieJar: jar,
      fetchImpl,
      label: "bb desktop on mac",
      now: () => 0,
      readAuthorization: () => "Bearer bbl_secret",
      serverUrl: "http://127.0.0.1:38886",
      windowUrl: "http://localhost:5173/",
    });
    expect(result).toEqual({ kind: "installed", expiresAt: 1_000 });
    const mint = fetchImpl.mock.calls[1];
    expect(mint?.[0]).toBe(
      "http://127.0.0.1:38886/api/v1/access/local-sessions",
    );
    expect(new Headers(mint?.[1]?.headers).get("authorization")).toBe(
      "Bearer bbl_secret",
    );
    expect(JSON.parse(String(mint?.[1]?.body))).toEqual({
      label: "bb desktop on mac",
    });
    expect(jar.sets).toEqual(
      ["http://127.0.0.1:38886", "http://localhost:5173"].map((url) => ({
        name: "bb_session_38886",
        value: "bbs_new",
        url,
        httpOnly: true,
        secure: false,
      })),
    );
  });

  it("reports a missing token so the window falls back to the sign-in screen", async () => {
    const fetchImpl = vi.fn<LocalServerFetch>(async () => json({}));
    const result = await ensureLocalBrowserSession({
      cookieJar: memoryCookieJar(),
      fetchImpl,
      label: "bb desktop on mac",
      now: () => 0,
      readAuthorization: () => null,
      serverUrl: "http://127.0.0.1:38886",
      windowUrl: "http://127.0.0.1:38886/",
    });
    expect(result).toEqual({ kind: "no-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
