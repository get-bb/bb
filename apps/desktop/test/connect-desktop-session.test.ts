import { describe, expect, it, vi } from "vitest";
import { installConnectDesktopSession } from "../src/connect-desktop-session.js";

describe("installConnectDesktopSession", () => {
  it("exchanges through the local plugin and installs an HttpOnly cookie", async () => {
    const set = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
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
        ),
    );
    await expect(
      installConnectDesktopSession({
        cookieInstaller: { set },
        fetchImpl,
        localServerUrl: "http://127.0.0.1:38886",
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toBe(true);
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
  });

  it("fails closed when the local plugin is unavailable", async () => {
    await expect(
      installConnectDesktopSession({
        cookieInstaller: { set: vi.fn() },
        fetchImpl: async () => {
          throw new Error("offline");
        },
        localServerUrl: "http://127.0.0.1:38886",
        remoteServerUrl: "https://laptop.getbb.app",
      }),
    ).resolves.toBe(false);
  });
});
