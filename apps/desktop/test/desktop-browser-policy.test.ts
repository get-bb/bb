import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserStateSchema,
} from "@bb/desktop-contract";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  resolveWindowOpenAction,
} from "../src/desktop-browser-policy.js";

describe("isAllowedBrowserUrl", () => {
  it("allows http and https", () => {
    expect(isAllowedBrowserUrl("https://example.com")).toBe(true);
    expect(isAllowedBrowserUrl("http://example.com/path?q=1")).toBe(true);
  });

  it("blocks non-http(s) and unparseable URLs", () => {
    expect(isAllowedBrowserUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedBrowserUrl("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isAllowedBrowserUrl("about:blank")).toBe(false);
    expect(isAllowedBrowserUrl("not a url")).toBe(false);
    expect(isAllowedBrowserUrl("")).toBe(false);
  });
});

describe("resolveWindowOpenAction", () => {
  it("surfaces an allowed http(s) popup URL as a new-tab request", () => {
    expect(resolveWindowOpenAction("https://example.com")).toEqual({
      openTabUrl: "https://example.com",
    });
  });

  it("denies popups to disallowed schemes (no new tab)", () => {
    expect(resolveWindowOpenAction("file:///etc/passwd")).toEqual({
      openTabUrl: null,
    });
    expect(resolveWindowOpenAction("javascript:alert(1)")).toEqual({
      openTabUrl: null,
    });
  });

  it("surfaces loopback and LAN popups like any other http(s) URL", () => {
    for (const url of [
      "http://localhost:5173/",
      "https://app.localhost/path",
      "http://127.0.0.1:38886/",
      "http://[::1]:5173/",
      "http://192.168.1.1/",
      "http://printer.local/",
    ]) {
      expect(resolveWindowOpenAction(url)).toEqual({ openTabUrl: url });
    }
  });
});

describe("browser IPC payload schemas", () => {
  it("accepts a well-formed attach request and rejects bad shapes", () => {
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0, y: 0, width: -1, height: 600 },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        layout: { left: 0, top: 0, rightInset: 0, bottomInset: 0 },
        visible: false,
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed state push and rejects non-integer bounds", () => {
    expect(
      bbDesktopBrowserStateSchema.safeParse({
        tabId: "browser:abc",
        url: "https://example.com",
        title: "Example",
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0.5, y: 0, width: 800, height: 600 },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized URLs beyond the length cap", () => {
    const longUrl = `https://example.com/${"a".repeat(
      BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
    )}`;
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: longUrl,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: true,
      }).success,
    ).toBe(false);
  });
});

describe("evaluatePopupRate", () => {
  const args = { windowMs: 10_000, maxInWindow: 3 };

  it("allows popups up to the cap, then blocks within the window", () => {
    let timestamps: number[] = [];
    for (const now of [0, 100, 200]) {
      const decision = evaluatePopupRate({ ...args, timestamps, now });
      expect(decision.allowed).toBe(true);
      timestamps = decision.timestamps;
    }
    const blocked = evaluatePopupRate({ ...args, timestamps, now: 300 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.timestamps).toHaveLength(3);
  });

  it("allows again once old timestamps age out of the window", () => {
    const timestamps = [0, 100, 200];
    const decision = evaluatePopupRate({ ...args, timestamps, now: 11_000 });
    expect(decision.allowed).toBe(true);
    expect(decision.timestamps).toEqual([11_000]);
  });
});
