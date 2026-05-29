import { describe, expect, it } from "vitest";
import {
  isHttpOrHttpsUrl,
  resolveChatLinkOpenTarget,
} from "./in-app-browser-link-preference";

describe("isHttpOrHttpsUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpOrHttpsUrl("http://example.com")).toBe(true);
    expect(isHttpOrHttpsUrl("https://example.com/docs?q=1#frag")).toBe(true);
    expect(isHttpOrHttpsUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects non-http schemes, relative paths, and protocol-relative URLs", () => {
    expect(isHttpOrHttpsUrl("mailto:hi@example.com")).toBe(false);
    expect(isHttpOrHttpsUrl("file:///Users/me/app.ts")).toBe(false);
    expect(isHttpOrHttpsUrl("/projects/abc")).toBe(false);
    expect(isHttpOrHttpsUrl("#section")).toBe(false);
    expect(isHttpOrHttpsUrl("//example.com")).toBe(false);
    expect(isHttpOrHttpsUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("resolveChatLinkOpenTarget", () => {
  it("routes http(s) links into the in-app browser on desktop when enabled", () => {
    expect(
      resolveChatLinkOpenTarget({
        desktopBrowserAvailable: true,
        openInAppBrowser: true,
        url: "https://example.com/docs",
      }),
    ).toBe("in-app-browser");
    expect(
      resolveChatLinkOpenTarget({
        desktopBrowserAvailable: true,
        openInAppBrowser: true,
        url: "http://example.com",
      }),
    ).toBe("in-app-browser");
  });

  it("keeps default behavior when the preference is off", () => {
    expect(
      resolveChatLinkOpenTarget({
        desktopBrowserAvailable: true,
        openInAppBrowser: false,
        url: "https://example.com/docs",
      }),
    ).toBe("default");
  });

  it("keeps default behavior when the desktop browser is unavailable (web)", () => {
    expect(
      resolveChatLinkOpenTarget({
        desktopBrowserAvailable: false,
        openInAppBrowser: true,
        url: "https://example.com/docs",
      }),
    ).toBe("default");
  });

  it("never routes non-http links, even on desktop with the preference on", () => {
    for (const url of [
      "mailto:hi@example.com",
      "file:///Users/me/app.ts",
      "/projects/abc",
      "#section",
    ]) {
      expect(
        resolveChatLinkOpenTarget({
          desktopBrowserAvailable: true,
          openInAppBrowser: true,
          url,
        }),
      ).toBe("default");
    }
  });
});
