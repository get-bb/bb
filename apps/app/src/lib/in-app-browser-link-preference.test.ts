import { describe, expect, it } from "vitest";
import {
  isHttpOrHttpsUrl,
  openUrlByPreference,
  resolveUrlOpenTarget,
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

describe("resolveUrlOpenTarget", () => {
  it("routes http(s) links into the in-app browser on desktop when enabled", () => {
    expect(
      resolveUrlOpenTarget({
        desktopBrowserAvailable: true,
        openLinksInAppBrowser: true,
        url: "https://example.com/docs",
      }),
    ).toBe("in-app-browser");
    expect(
      resolveUrlOpenTarget({
        desktopBrowserAvailable: true,
        openLinksInAppBrowser: true,
        url: "http://example.com",
      }),
    ).toBe("in-app-browser");
  });

  it("routes http(s) links to the external browser when the preference is off", () => {
    expect(
      resolveUrlOpenTarget({
        desktopBrowserAvailable: true,
        openLinksInAppBrowser: false,
        url: "https://example.com/docs",
      }),
    ).toBe("external-browser");
  });

  it("routes http(s) links to the external browser when the desktop browser is unavailable (web)", () => {
    expect(
      resolveUrlOpenTarget({
        desktopBrowserAvailable: false,
        openLinksInAppBrowser: true,
        url: "https://example.com/docs",
      }),
    ).toBe("external-browser");
  });

  it("does not handle non-http links, even on desktop with the preference on", () => {
    for (const url of [
      "mailto:hi@example.com",
      "file:///Users/me/app.ts",
      "/projects/abc",
      "#section",
    ]) {
      expect(
        resolveUrlOpenTarget({
          desktopBrowserAvailable: true,
          openLinksInAppBrowser: true,
          url,
        }),
      ).toBe("unhandled");
    }
  });
});

describe("openUrlByPreference", () => {
  it("opens http(s) URLs in the in-app browser when enabled", () => {
    const openedInApp: string[] = [];
    const openedExternally: string[] = [];

    expect(
      openUrlByPreference({
        desktopBrowserAvailable: true,
        openExternalBrowser: (url) => openedExternally.push(url),
        openInAppBrowser: (url) => openedInApp.push(url),
        openLinksInAppBrowser: true,
        url: "https://example.com/docs",
      }),
    ).toBe(true);

    expect(openedInApp).toEqual(["https://example.com/docs"]);
    expect(openedExternally).toEqual([]);
  });

  it("opens http(s) URLs externally when disabled", () => {
    const openedInApp: string[] = [];
    const openedExternally: string[] = [];

    expect(
      openUrlByPreference({
        desktopBrowserAvailable: true,
        openExternalBrowser: (url) => openedExternally.push(url),
        openInAppBrowser: (url) => openedInApp.push(url),
        openLinksInAppBrowser: false,
        url: "https://example.com/docs",
      }),
    ).toBe(true);

    expect(openedInApp).toEqual([]);
    expect(openedExternally).toEqual(["https://example.com/docs"]);
  });

  it("leaves file links and non-web schemes to their dedicated handlers", () => {
    const openedInApp: string[] = [];
    const openedExternally: string[] = [];

    expect(
      openUrlByPreference({
        desktopBrowserAvailable: true,
        openExternalBrowser: (url) => openedExternally.push(url),
        openInAppBrowser: (url) => openedInApp.push(url),
        openLinksInAppBrowser: true,
        url: "file:///Users/me/app.ts",
      }),
    ).toBe(false);

    expect(openedInApp).toEqual([]);
    expect(openedExternally).toEqual([]);
  });
});
