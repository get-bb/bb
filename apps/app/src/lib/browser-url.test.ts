import { describe, expect, it } from "vitest";
import {
  getBrowserUrlHost,
  getBrowserUrlSecurity,
  looksLikeUrl,
  resolveBrowserAddressInput,
} from "./browser-url";

describe("looksLikeUrl", () => {
  it("treats explicit http(s) schemes as URLs", () => {
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("http://example.com/path?q=1")).toBe(true);
    expect(looksLikeUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("treats bare host.tld and localhost shapes as URLs", () => {
    expect(looksLikeUrl("example.com")).toBe(true);
    expect(looksLikeUrl("news.ycombinator.com")).toBe(true);
    expect(looksLikeUrl("example.com:8080/path")).toBe(true);
    expect(looksLikeUrl("localhost:3000")).toBe(true);
    expect(looksLikeUrl("127.0.0.1:38886")).toBe(true);
  });

  it("treats queries and non-http schemes as searches, not URLs", () => {
    expect(looksLikeUrl("how to center a div")).toBe(false);
    expect(looksLikeUrl("electron webcontentsview")).toBe(false);
    expect(looksLikeUrl("single")).toBe(false);
    expect(looksLikeUrl("javascript:alert(1)")).toBe(false);
    expect(looksLikeUrl("file:///etc/passwd")).toBe(false);
    expect(looksLikeUrl("data:text/html,<h1>x</h1>")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });
});

describe("resolveBrowserAddressInput", () => {
  it("returns null for blank input", () => {
    expect(resolveBrowserAddressInput("")).toBeNull();
    expect(resolveBrowserAddressInput("   ")).toBeNull();
  });

  it("preserves an explicit http(s) URL", () => {
    expect(resolveBrowserAddressInput("https://example.com")).toBe(
      "https://example.com",
    );
    expect(resolveBrowserAddressInput("  http://example.com/x  ")).toBe(
      "http://example.com/x",
    );
  });

  it("prepends https:// to a bare host", () => {
    expect(resolveBrowserAddressInput("example.com")).toBe(
      "https://example.com",
    );
    expect(resolveBrowserAddressInput("localhost:3000")).toBe(
      "https://localhost:3000",
    );
  });

  it("builds a search URL for non-URL input", () => {
    expect(resolveBrowserAddressInput("hello world")).toBe(
      "https://www.google.com/search?q=hello%20world",
    );
  });

  it("routes a non-http scheme to search rather than navigating to it", () => {
    expect(resolveBrowserAddressInput("javascript:alert(1)")).toBe(
      "https://www.google.com/search?q=javascript%3Aalert(1)",
    );
  });
});

describe("getBrowserUrlSecurity", () => {
  it("classifies the scheme", () => {
    expect(getBrowserUrlSecurity("https://example.com")).toBe("secure");
    expect(getBrowserUrlSecurity("http://example.com")).toBe("insecure");
    expect(getBrowserUrlSecurity("")).toBe("none");
    expect(getBrowserUrlSecurity("not a url")).toBe("none");
  });
});

describe("getBrowserUrlHost", () => {
  it("returns the host for a parseable URL", () => {
    expect(getBrowserUrlHost("https://news.ycombinator.com/item?id=1")).toBe(
      "news.ycombinator.com",
    );
  });

  it("falls back to the raw value when unparseable", () => {
    expect(getBrowserUrlHost("")).toBe("");
    expect(getBrowserUrlHost("not a url")).toBe("not a url");
  });
});
