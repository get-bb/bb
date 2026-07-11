import { describe, expect, it, vi } from "vitest";
import {
  type DesktopCookieStore,
  installConnectDesktopSession,
} from "../src/connect-desktop-session.js";

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

function successfulResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      result: {
        cookie: {
          domain: ".getbb.app",
          expiresAt: 1_800_000,
          name: "__Secure-bb-connect.desktop_session",
          value: "signed-session",
        },
      },
    }),
  );
}

describe("installConnectDesktopSession", () => {
  it("exchanges through the local plugin, installs, and verifies the cookie", async () => {
    const cookieStore = createCookieStore();
    const set = vi.spyOn(cookieStore, "set");
    const get = vi.spyOn(cookieStore, "get");
    const fetchImpl = vi.fn(async () => successfulResponse());

    await expect(
      installConnectDesktopSession({
        cookieStore,
        fetchImpl,
        localServerUrl: "http://127.0.0.1:38886",
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        "http://127.0.0.1:38886/api/v1/plugins/connect/rpc/createDesktopSession",
      ),
      expect.objectContaining({ method: "POST" }),
    );
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

  it("returns an actionable network failure when the local plugin is unavailable", async () => {
    await expect(
      installConnectDesktopSession({
        cookieStore: createCookieStore(),
        fetchImpl: async () => {
          throw new Error("offline");
        },
        localServerUrl: "http://127.0.0.1:38886",
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({ code: "network", detail: "offline", ok: false });
  });

  it("reports rejected and malformed RPC responses", async () => {
    const args = {
      cookieStore: createCookieStore(),
      localServerUrl: "http://127.0.0.1:38886",
      remoteServerUrl: "https://laptop.getbb.app",
    };
    await expect(
      installConnectDesktopSession({
        ...args,
        fetchImpl: async () => new Response("no", { status: 503 }),
      }),
    ).resolves.toEqual({
      code: "request_rejected",
      detail: "HTTP 503",
      ok: false,
    });
    await expect(
      installConnectDesktopSession({
        ...args,
        fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
      }),
    ).resolves.toEqual({
      code: "invalid_response",
      detail: "response did not match the contract",
      ok: false,
    });
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
        fetchImpl: async () => successfulResponse(),
        localServerUrl: "http://127.0.0.1:38886",
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
        fetchImpl: async () => successfulResponse(),
        localServerUrl: "http://127.0.0.1:38886",
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toEqual({
      code: "cookie_verification_failed",
      detail: "Electron did not retain the desktop session cookie",
      ok: false,
    });
  });
});
