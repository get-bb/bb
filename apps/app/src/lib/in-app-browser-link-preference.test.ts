import { describe, expect, it } from "vitest";
import { openUrlByPreference } from "./in-app-browser-link-preference";

describe("openUrlByPreference", () => {
  it.each([
    {
      name: "opens http(s) URLs in the in-app browser when enabled on desktop",
      desktopBrowserAvailable: true,
      openLinksInAppBrowser: true,
      url: "https://example.com/docs",
      handled: true,
      inApp: ["https://example.com/docs"],
      external: [],
    },
    {
      name: "matches the http scheme case-insensitively",
      desktopBrowserAvailable: true,
      openLinksInAppBrowser: true,
      url: "HTTP://EXAMPLE.COM",
      handled: true,
      inApp: ["HTTP://EXAMPLE.COM"],
      external: [],
    },
    {
      name: "opens http(s) URLs externally when the preference is off",
      desktopBrowserAvailable: true,
      openLinksInAppBrowser: false,
      url: "https://example.com/docs",
      handled: true,
      inApp: [],
      external: ["https://example.com/docs"],
    },
    {
      name: "opens http(s) URLs externally when the desktop browser is unavailable (web)",
      desktopBrowserAvailable: false,
      openLinksInAppBrowser: true,
      url: "https://example.com/docs",
      handled: true,
      inApp: [],
      external: ["https://example.com/docs"],
    },
    {
      name: "routes application links externally even when the in-app browser is preferred",
      desktopBrowserAvailable: true,
      openLinksInAppBrowser: true,
      url: "reflect://note/Project%20X",
      handled: true,
      inApp: [],
      external: ["reflect://note/Project%20X"],
    },
  ])(
    "$name",
    ({
      desktopBrowserAvailable,
      openLinksInAppBrowser,
      url,
      handled,
      inApp,
      external,
    }) => {
      const openedInApp: string[] = [];
      const openedExternally: string[] = [];

      expect(
        openUrlByPreference({
          desktopBrowserAvailable,
          openLinksInAppBrowser,
          openExternalBrowser: (opened) => openedExternally.push(opened),
          openInAppBrowser: (opened) => openedInApp.push(opened),
          url,
        }),
      ).toBe(handled);

      expect(openedInApp).toEqual(inApp);
      expect(openedExternally).toEqual(external);
    },
  );

  it.each([
    "mailto:hi@example.com",
    "file:///Users/me/app.ts",
    "/projects/abc",
    "#section",
    "//example.com",
    "javascript:alert(1)",
  ])("leaves %s to its dedicated handler", (url) => {
    const openedInApp: string[] = [];
    const openedExternally: string[] = [];

    expect(
      openUrlByPreference({
        desktopBrowserAvailable: true,
        openLinksInAppBrowser: true,
        openExternalBrowser: (opened) => openedExternally.push(opened),
        openInAppBrowser: (opened) => openedInApp.push(opened),
        url,
      }),
    ).toBe(false);

    expect(openedInApp).toEqual([]);
    expect(openedExternally).toEqual([]);
  });
});
