import { describe, expect, it } from "vitest";
import { deviceBrowserCookieSpec, sessionCookieSpec } from "./cookie-store";

const session = {
  cookie: {
    name: "__Secure-bb-connect.desktop_session",
    value: "abc.def",
    domain: ".getbb.app",
    expiresAt: Date.UTC(2026, 7, 18, 11),
  },
};

describe("sessionCookieSpec", () => {
  it("marks the cookie Secure only for https servers", () => {
    expect(sessionCookieSpec(session, "https://bee.getbb.app")).toEqual({
      name: "__Secure-bb-connect.desktop_session",
      value: "abc.def",
      domain: ".getbb.app",
      path: "/",
      secure: true,
      httpOnly: true,
      expires: "2026-08-18T11:00:00.000+00:00",
    });
    expect(
      sessionCookieSpec(
        { cookie: { ...session.cookie, domain: "127.0.0.1" } },
        "http://127.0.0.1:42998",
      ),
    ).toMatchObject({ secure: false, domain: "127.0.0.1" });
  });

  it("rejects a cookie domain the server host does not domain-match", () => {
    const rogue = "https://bee.getbb.app.evil.example";
    for (const domain of ["bee.getbb.app", ".getbb.app", "getbb.app"]) {
      expect(() =>
        sessionCookieSpec({ cookie: { ...session.cookie, domain } }, rogue),
      ).toThrow(/does not match bee\.getbb\.app\.evil\.example/u);
    }
    expect(() =>
      sessionCookieSpec(
        { cookie: { ...session.cookie, domain: "ant.getbb.app" } },
        "https://bee.getbb.app",
      ),
    ).toThrow(/does not match/u);
    expect(() =>
      sessionCookieSpec(
        { cookie: { ...session.cookie, domain: "ee.getbb.app" } },
        "https://bee.getbb.app",
      ),
    ).toThrow(/does not match/u);
  });

  it("accepts the host itself and any parent domain", () => {
    for (const domain of [
      "bee.getbb.app",
      ".bee.getbb.app",
      ".getbb.app",
      "getbb.app",
      "GetBB.app",
    ]) {
      expect(
        sessionCookieSpec(
          { cookie: { ...session.cookie, domain } },
          "https://bee.getbb.app",
        ),
      ).toMatchObject({ domain });
    }
  });
});

describe("deviceBrowserCookieSpec", () => {
  it("scopes the WebView's short session to the server host, its own expiry, and Secure only for https", () => {
    const session = {
      token: "bbs_child",
      cookieName: "bb_session_38886",
      expiresAt: Date.UTC(2026, 10, 19, 13),
    };
    expect(
      deviceBrowserCookieSpec(session, "http://192.168.1.20:38886"),
    ).toEqual({
      name: "bb_session_38886",
      value: "bbs_child",
      domain: "192.168.1.20",
      path: "/",
      secure: false,
      httpOnly: true,
      expires: "2026-11-19T13:00:00.000+00:00",
    });
    expect(
      deviceBrowserCookieSpec(session, "https://mac.tail.ts.net"),
    ).toMatchObject({ domain: "mac.tail.ts.net", secure: true });
  });
});
