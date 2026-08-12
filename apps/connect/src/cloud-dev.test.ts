import { describe, expect, it } from "vitest";
import {
  CLOUD_DEV_HOST_HEADER,
  publicConnectOrigin,
  resolveConnectRequestHost,
  resolveConnectRequestUrl,
  resolveConnectRuntime,
} from "./cloud-dev.js";

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
    expect(publicConnectOrigin("sawyer--3000", runtime)).toBe(
      "http://sawyer--3000.bb.localhost:8787",
    );
    expect(
      resolveConnectRequestUrl(
        "http://127.0.0.1:50743/threads/thr_1?view=full",
        headers,
        runtime,
      ).toString(),
    ).toBe("http://sawyer--3000.bb.localhost:8787/threads/thr_1?view=full");
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
});
