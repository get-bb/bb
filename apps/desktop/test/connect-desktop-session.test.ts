import { describe, expect, it, vi } from "vitest";
import {
  createCredentialCookieSource,
  createLocalServerCookieSource,
  installConnectDesktopSession,
  type DesktopCookieStore,
} from "../src/connect-desktop-session.js";

const CREDENTIAL = {
  credential: "bbcm_desktop",
  handle: "laptop",
  serverUrl: "https://laptop.getbb.app",
};

function createCookieStore(): DesktopCookieStore {
  let installed: { name: string; value: string } | null = null;
  return {
    async get() {
      return installed === null ? [] : [installed];
    },
    async set(details) {
      installed = { name: details.name, value: details.value };
    },
  };
}

const COOKIE = {
  domain: ".getbb.app",
  expiresAt: 1_800_000,
  name: "__Secure-bb-connect.desktop_session",
  value: "signed-session",
};

function localRpcResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { cookie: COOKIE } }));
}

function gateResponse(): Response {
  return new Response(JSON.stringify({ cookie: COOKIE }));
}

function successfulSource() {
  return async () => ({ cookie: COOKIE, ok: true }) as const;
}

describe("installConnectDesktopSession", () => {
  it("installs and verifies the cookie the source minted", async () => {
    const cookieStore = createCookieStore();
    const set = vi.spyOn(cookieStore, "set");
    const get = vi.spyOn(cookieStore, "get");

    await expect(
      installConnectDesktopSession({
        cookieStore,
        mintCookie: successfulSource(),
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({ expiresAt: 1_800_000, ok: true });
    expect(set).toHaveBeenCalledWith({
      domain: ".getbb.app",
      expirationDate: 1800,
      httpOnly: true,
      name: "__Secure-bb-connect.desktop_session",
      path: "/",
      sameSite: "lax",
      secure: true,
      url: "https://laptop.getbb.app",
      value: "signed-session",
    });
    expect(get).toHaveBeenCalledWith({
      name: "__Secure-bb-connect.desktop_session",
      url: "https://laptop.getbb.app",
    });
  });

  it("passes a mint failure through untouched", async () => {
    await expect(
      installConnectDesktopSession({
        cookieStore: createCookieStore(),
        mintCookie: async () => ({
          code: "unauthorized",
          detail: "revoked",
          ok: false,
        }),
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({ code: "unauthorized", detail: "revoked", ok: false });
  });

  it("fails when Electron rejects or does not retain the cookie", async () => {
    await expect(
      installConnectDesktopSession({
        cookieStore: {
          async get() {
            return [];
          },
          async set() {
            throw new Error("cookie rejected");
          },
        },
        mintCookie: successfulSource(),
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({
      code: "cookie_install_failed",
      detail: "cookie rejected",
      ok: false,
    });

    await expect(
      installConnectDesktopSession({
        cookieStore: {
          async get() {
            return [];
          },
          async set() {},
        },
        mintCookie: successfulSource(),
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({
      code: "cookie_verification_failed",
      detail: "Electron did not retain the desktop session cookie",
      ok: false,
    });
  });
});

describe("createLocalServerCookieSource", () => {
  it("exchanges through the local plugin RPC", async () => {
    const fetchImpl = vi.fn(async () => localRpcResponse());
    await expect(
      createLocalServerCookieSource({
        fetchImpl,
        localServerUrl: "http://127.0.0.1:38886",
      })(),
    ).resolves.toEqual({ cookie: COOKIE, ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        "http://127.0.0.1:38886/api/v1/plugins/connect/rpc/createDesktopSession",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reports unavailable, rejected, and malformed responses", async () => {
    await expect(
      createLocalServerCookieSource({
        fetchImpl: async () => {
          throw new Error("offline");
        },
        localServerUrl: "http://127.0.0.1:38886",
      })(),
    ).resolves.toEqual({ code: "network", detail: "offline", ok: false });

    await expect(
      createLocalServerCookieSource({
        fetchImpl: async () => new Response("no", { status: 503 }),
        localServerUrl: "http://127.0.0.1:38886",
      })(),
    ).resolves.toEqual({
      code: "request_rejected",
      detail: "HTTP 503",
      ok: false,
    });

    await expect(
      createLocalServerCookieSource({
        fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
        localServerUrl: "http://127.0.0.1:38886",
      })(),
    ).resolves.toEqual({
      code: "invalid_response",
      detail: "response did not match the contract",
      ok: false,
    });
  });
});

describe("createCredentialCookieSource", () => {
  it("mints straight from the connect gate with the machine credential", async () => {
    const fetchImpl = vi.fn(async () => gateResponse());
    await expect(
      createCredentialCookieSource({ credential: CREDENTIAL, fetchImpl })(),
    ).resolves.toEqual({ cookie: COOKIE, ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://laptop.getbb.app/api/connect/desktop-session",
      expect.objectContaining({
        headers: { "x-bb-connect-machine": "bbcm_desktop" },
        method: "POST",
      }),
    );
  });

  it("reports a refused credential as unauthorized so the caller can drop it", async () => {
    await expect(
      createCredentialCookieSource({
        credential: CREDENTIAL,
        fetchImpl: async () => new Response("no", { status: 403 }),
      })(),
    ).resolves.toMatchObject({ code: "unauthorized", ok: false });
  });
});
