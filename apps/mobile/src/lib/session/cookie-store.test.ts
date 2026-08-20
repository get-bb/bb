import { describe, expect, it } from "vitest";
import { installSessionCookie, sessionCookieSpec } from "./cookie-store";

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
      expires: "2026-08-18T11:00:00.000Z",
    });
    // A plain-http gate (local stub) must not get a Secure cookie: the jar
    // would never send it and every request would look unauthenticated.
    expect(
      sessionCookieSpec(
        { cookie: { ...session.cookie, domain: "127.0.0.1" } },
        "http://127.0.0.1:42998",
      ),
    ).toMatchObject({ secure: false, domain: "127.0.0.1" });
  });

  it("installs into the shared jar and the WebKit store", async () => {
    const calls: { url: string; secure: boolean; useWebKit: boolean }[] = [];
    await installSessionCookie(
      {
        set: async (url, cookie, useWebKit) => {
          calls.push({ url, secure: cookie.secure, useWebKit });
        },
      },
      "https://bee.getbb.app",
      session,
    );
    expect(calls).toEqual([
      { url: "https://bee.getbb.app", secure: true, useWebKit: false },
      { url: "https://bee.getbb.app", secure: true, useWebKit: true },
    ]);
  });
});
