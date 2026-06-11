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

  it("treats bare public hosts and loopback shapes as URLs", () => {
    expect(looksLikeUrl("example.com")).toBe(true);
    expect(looksLikeUrl("news.ycombinator.com")).toBe(true);
    expect(looksLikeUrl("example.com:8080/path")).toBe(true);
    expect(looksLikeUrl("8.8.8.8")).toBe(true);
    expect(looksLikeUrl("8.8.8.8:443/path")).toBe(true);
    expect(looksLikeUrl("localhost:3000")).toBe(true);
    expect(looksLikeUrl("localhost:3000?debug=1")).toBe(true);
    expect(looksLikeUrl("foo.localhost:3000/path")).toBe(true);
    expect(looksLikeUrl("127.0.0.1:38886")).toBe(true);
    expect(looksLikeUrl("[::1]:5173/#/route")).toBe(true);
  });

  it("treats queries, blocked local hosts, and non-http schemes as searches", () => {
    expect(looksLikeUrl("how to center a div")).toBe(false);
    expect(looksLikeUrl("electron webcontentsview")).toBe(false);
    expect(looksLikeUrl("single")).toBe(false);
    expect(looksLikeUrl("https://example.com\t@evil.com")).toBe(false);
    expect(looksLikeUrl("https://example.com @evil.com")).toBe(false);
    expect(looksLikeUrl("0.0.0.0:5173")).toBe(false);
    expect(looksLikeUrl("192.168.1.12:3000")).toBe(false);
    expect(looksLikeUrl("127.1:3000")).toBe(false);
    expect(looksLikeUrl("192.168.1:3000")).toBe(false);
    expect(looksLikeUrl("0xc0.0xa8.1.12:3000")).toBe(false);
    expect(looksLikeUrl("192.168.0x1.12:3000")).toBe(false);
    expect(looksLikeUrl("0127.0.0.1:5173")).toBe(false);
    expect(looksLikeUrl("0x7f.0.0.1:5173")).toBe(false);
    expect(looksLikeUrl("printer.local")).toBe(false);
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

  it("prepends https:// to a public bare host", () => {
    expect(resolveBrowserAddressInput("example.com")).toBe(
      "https://example.com",
    );
    expect(resolveBrowserAddressInput("example.com:8080/path")).toBe(
      "https://example.com:8080/path",
    );
    expect(resolveBrowserAddressInput("8.8.8.8")).toBe("https://8.8.8.8");
    expect(resolveBrowserAddressInput("1.1.1.1/dns-query")).toBe(
      "https://1.1.1.1/dns-query",
    );
  });

  it("prepends http:// to bare localhost inputs", () => {
    expect(resolveBrowserAddressInput("localhost:5173")).toBe(
      "http://localhost:5173",
    );
    expect(resolveBrowserAddressInput("localhost:5173?debug=1")).toBe(
      "http://localhost:5173?debug=1",
    );
    expect(resolveBrowserAddressInput("localhost:5173/#/route")).toBe(
      "http://localhost:5173/#/route",
    );
  });

  it("prepends http:// to bare localhost subdomains", () => {
    expect(resolveBrowserAddressInput("foo.localhost")).toBe(
      "http://foo.localhost",
    );
    expect(resolveBrowserAddressInput("foo.localhost:5173/path")).toBe(
      "http://foo.localhost:5173/path",
    );
  });

  it("prepends http:// to bare loopback IP literals", () => {
    expect(resolveBrowserAddressInput("127.0.0.1:3000/path")).toBe(
      "http://127.0.0.1:3000/path",
    );
    expect(resolveBrowserAddressInput("[::1]:5173")).toBe("http://[::1]:5173");
    expect(resolveBrowserAddressInput("[::1]:5173/#/route")).toBe(
      "http://[::1]:5173/#/route",
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
    expect(resolveBrowserAddressInput("file:///etc/passwd")).toBe(
      "https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd",
    );
  });

  it("routes explicit http(s) inputs with embedded whitespace to search", () => {
    expect(resolveBrowserAddressInput("https://example.com\t@evil.com")).toBe(
      "https://www.google.com/search?q=https%3A%2F%2Fexample.com%09%40evil.com",
    );
    expect(resolveBrowserAddressInput("https://example.com @evil.com")).toBe(
      "https://www.google.com/search?q=https%3A%2F%2Fexample.com%20%40evil.com",
    );
    expect(resolveBrowserAddressInput("https://example.com\n@evil.com")).toBe(
      "https://www.google.com/search?q=https%3A%2F%2Fexample.com%0A%40evil.com",
    );
  });

  it("routes blocked local hosts to search rather than navigating to them", () => {
    expect(resolveBrowserAddressInput("0.0.0.0:5173")).toBe(
      "https://www.google.com/search?q=0.0.0.0%3A5173",
    );
    expect(resolveBrowserAddressInput("192.168.1.12:3000")).toBe(
      "https://www.google.com/search?q=192.168.1.12%3A3000",
    );
    expect(resolveBrowserAddressInput("127.1:3000")).toBe(
      "https://www.google.com/search?q=127.1%3A3000",
    );
    expect(resolveBrowserAddressInput("192.168.1:3000")).toBe(
      "https://www.google.com/search?q=192.168.1%3A3000",
    );
    expect(resolveBrowserAddressInput("0xc0.0xa8.1.12:3000")).toBe(
      "https://www.google.com/search?q=0xc0.0xa8.1.12%3A3000",
    );
    expect(resolveBrowserAddressInput("192.168.0x1.12:3000")).toBe(
      "https://www.google.com/search?q=192.168.0x1.12%3A3000",
    );
    expect(resolveBrowserAddressInput("0127.0.0.1:5173")).toBe(
      "https://www.google.com/search?q=0127.0.0.1%3A5173",
    );
    expect(resolveBrowserAddressInput("0x7f.0.0.1:5173")).toBe(
      "https://www.google.com/search?q=0x7f.0.0.1%3A5173",
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
