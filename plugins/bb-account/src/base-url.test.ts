import { describe, expect, it } from "vitest";
import {
  createBaseUrlAllowed,
  normalizeOrigin,
  resolveDefaultBaseUrl,
} from "./base-url.js";

const configured = "https://bb.example.test";

describe("trusted account origin policy", () => {
  it("adds exact normalized HTTPS origins without changing defaults", () => {
    const env = {
      NODE_ENV: "production",
      BB_ACCOUNT_TRUSTED_ORIGINS:
        "https://BB.example.test:443/, https://another.example.test:8443",
    };
    const allowed = createBaseUrlAllowed(env);
    for (const origin of [
      configured,
      "https://another.example.test:8443",
      "https://getbb.app",
      "https://vibecodethis.site",
    ])
      expect(allowed(origin), origin).toBe(true);
    for (const origin of [
      "https://child.bb.example.test",
      "https://bb.example.test.evil.test",
      "https://another.example.test",
      "https://bb.example.test:8443",
      "http://bb.example.test",
      "http://bb.localhost:1234",
    ])
      expect(allowed(origin), origin).toBe(false);
    expect(resolveDefaultBaseUrl(env)).toBe("https://getbb.app");
  });

  it.each([
    "",
    " ",
    ",",
    "https://valid.test,",
    "https://valid.test,,https://other.test",
    "http://bb.example.test",
    "http://bb.localhost:1234",
    "file:///tmp/site",
    "javascript:alert(1)",
    "https://user:password@bb.example.test",
    "https://@bb.example.test",
    "https://*.example.test",
    "https://bb.example.test/path",
    "https://bb.example.test/../",
    "https://bb.example.test?",
    "https://bb.example.test?q=1",
    "https://bb.example.test#",
    "https://bb.example.test#fragment",
    "https://bb.example.test\\",
    "https://bb.exam\nple.test",
    "not a URL",
  ])("rejects invalid operator config %j", (value) => {
    expect(() =>
      createBaseUrlAllowed({
        NODE_ENV: "production",
        BB_ACCOUNT_TRUSTED_ORIGINS: value,
      }),
    ).toThrow("BB_ACCOUNT_TRUSTED_ORIGINS must be");
  });

  it("snapshots trust and preserves development-only localhost access", () => {
    const env = {
      NODE_ENV: "development",
      BB_ACCOUNT_TRUSTED_ORIGINS: configured,
    };
    const allowed = createBaseUrlAllowed(env);
    env.BB_ACCOUNT_TRUSTED_ORIGINS = "https://later.test";
    env.NODE_ENV = "production";
    expect(allowed(configured)).toBe(true);
    expect(allowed("https://later.test")).toBe(false);
    expect(allowed("http://bb.localhost:1234")).toBe(true);
    expect(allowed("http://bb.localhost:1234/path")).toBe(false);
    expect(allowed("not a URL")).toBe(false);
  });

  it.each([
    `${configured}/path`,
    `${configured}/../`,
    `${configured}?`,
    `${configured}#`,
    "https://user:secret@bb.example.test",
    "https://*.example.test",
    `${configured}\\`,
    `${configured}\n`,
  ])("rejects a non-origin override %j", (value) => {
    expect(() => normalizeOrigin(value, "baseUrl")).toThrow();
  });

  it("keeps origin spelling normalization and a trailing root slash", () => {
    expect(normalizeOrigin("HTTPS://BB.example.test:443/", "baseUrl")).toBe(
      configured,
    );
  });
});
