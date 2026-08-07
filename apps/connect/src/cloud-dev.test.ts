import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_DEV_HOST_HEADER,
  resolveConnectRequestHost,
  resolveConnectRuntime,
  waitForCloudService,
} from "./cloud-dev.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("local Cloud request routing", () => {
  it("accepts the launcher host and selects HTTP cookies only in local Cloud", () => {
    const runtime = resolveConnectRuntime({
      ACCOUNT_APP_URL: "http://bb.localhost:8787",
      BASE_DOMAIN: "bb.localhost",
      CLOUD_DEV: "true",
    });
    const headers = new Headers({
      host: "localhost",
      [CLOUD_DEV_HOST_HEADER]: "sawyer--3000",
    });
    expect(resolveConnectRequestHost(headers, runtime)).toBe(
      "sawyer--3000.bb.localhost",
    );
    expect(runtime.sessionCookieName).toBe("better-auth.session_token");
    expect(runtime.desktopSessionCookieName).toBe("bb-connect.desktop_session");
  });

  it("ignores the launcher header in production", () => {
    const runtime = resolveConnectRuntime({ BASE_DOMAIN: "getbb.app" });
    const headers = new Headers({
      host: "sawyer.getbb.app",
      [CLOUD_DEV_HOST_HEADER]: "attacker",
    });
    expect(resolveConnectRequestHost(headers, runtime)).toBe(
      "sawyer.getbb.app",
    );
    expect(runtime.sessionCookieName).toBe(
      "__Secure-better-auth.session_token",
    );
  });

  it("rejects deployed credential auth", () => {
    expect(() =>
      resolveConnectRuntime({
        ACCOUNT_APP_URL: "https://getbb.app",
        BASE_DOMAIN: "getbb.app",
        CLOUD_DEV: "true",
      }),
    ).toThrow("only allowed for local Cloud development");
  });

  it("backs off after a 500 response and cancels its body", async () => {
    vi.useFakeTimers();
    const unavailable = new Response("starting", { status: 500 });
    const cancel = vi.spyOn(unavailable.body!, "cancel");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const ready = waitForCloudService({
      url: "http://127.0.0.1:42745/dashboard",
      host: "bb.localhost:42745",
      serviceExited: () => false,
      timeoutMs: 1_000,
      retryDelayMs: 250,
      fetchImpl,
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await ready;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
