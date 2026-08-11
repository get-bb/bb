import { describe, expect, it } from "vitest";

import { resolveSiteOrigin } from "./site-origin.js";

describe("resolveSiteOrigin", () => {
  it("keeps production and staging distinct", () => {
    expect(resolveSiteOrigin("https://getbb.app")).toBe("https://getbb.app");
    expect(resolveSiteOrigin("https://vibecodethis.site")).toBe(
      "https://vibecodethis.site",
    );
  });

  it("drops any path so og:image resolves against the root", () => {
    expect(resolveSiteOrigin("https://getbb.app/")).toBe("https://getbb.app");
    expect(resolveSiteOrigin("https://getbb.app/dashboard")).toBe(
      "https://getbb.app",
    );
  });

  it("keeps a non-default port (cloud dev tunnels use one)", () => {
    expect(resolveSiteOrigin("http://bb.localhost:8787")).toBe(
      "http://bb.localhost:8787",
    );
  });

  it("fails the build rather than guessing an origin", () => {
    expect(() => resolveSiteOrigin(undefined)).toThrow(/APP_URL is missing/);
    expect(() => resolveSiteOrigin("   ")).toThrow(/APP_URL is missing/);
    expect(() => resolveSiteOrigin("getbb.app")).toThrow(/not a valid URL/);
  });
});
