import { describe, expect, it } from "vitest";
import { resolveDevEmailPasswordEnabled } from "./local-auth.js";

describe("resolveDevEmailPasswordEnabled", () => {
  it("enables credential auth only on the local Cloud origin", () => {
    expect(
      resolveDevEmailPasswordEnabled({
        APP_URL: "http://bb.localhost:8787",
        BASE_DOMAIN: "bb.localhost",
        DEV_EMAIL_PASSWORD_AUTH: "true",
      }),
    ).toBe(true);

    expect(
      resolveDevEmailPasswordEnabled({
        APP_URL: "https://getbb.app",
        BASE_DOMAIN: "getbb.app",
      }),
    ).toBe(false);

    expect(() =>
      resolveDevEmailPasswordEnabled({
        APP_URL: "https://getbb.app",
        BASE_DOMAIN: "getbb.app",
        DEV_EMAIL_PASSWORD_AUTH: "true",
      }),
    ).toThrow("only allowed for local Cloud development");
  });

  it("rejects ambiguous flag values", () => {
    expect(() =>
      resolveDevEmailPasswordEnabled({
        APP_URL: "http://bb.localhost:8787",
        BASE_DOMAIN: "bb.localhost",
        DEV_EMAIL_PASSWORD_AUTH: "1",
      }),
    ).toThrow("must be true when set");
  });
});
