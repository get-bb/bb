import { describe, expect, it } from "vitest";
import { rewriteLocalhostLinkHref } from "./localhost-link-rewrite-preference";

describe("rewriteLocalhostLinkHref", () => {
  it("rewrites localhost and 127.0.0.1 http links to the current page hostname", () => {
    expect(
      rewriteLocalhostLinkHref({
        currentHostname: "100.64.158.8",
        enabled: true,
        href: "http://localhost:5173/app?debug=1#ready",
      }),
    ).toBe("http://100.64.158.8:5173/app?debug=1#ready");

    expect(
      rewriteLocalhostLinkHref({
        currentHostname: "100.64.158.8",
        enabled: true,
        href: "https://127.0.0.1:8443/",
      }),
    ).toBe("https://100.64.158.8:8443/");
  });

  it("leaves visible hrefs unchanged when disabled or not a localhost http link", () => {
    expect(
      rewriteLocalhostLinkHref({
        currentHostname: "100.64.158.8",
        enabled: false,
        href: "http://localhost:5173/",
      }),
    ).toBe("http://localhost:5173/");

    for (const href of [
      "https://example.com/docs",
      "mailto:hi@example.com",
      "/projects/proj_123",
      "file:///workspace/app.ts",
      "not a url",
      undefined,
    ]) {
      expect(
        rewriteLocalhostLinkHref({
          currentHostname: "100.64.158.8",
          enabled: true,
          href,
        }),
      ).toBe(href);
    }
  });
});
