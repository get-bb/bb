import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserStateSchema,
} from "@bb/server-contract";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  isBlockedBrowserRequestHost,
  isBlockedBrowserRequestUrl,
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
});

describe("browser IPC payload schemas", () => {
  it("accepts a well-formed attach request and rejects bad shapes", () => {
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        layout: { left: 0, top: 0, rightInset: 0, bottomInset: 0 },
        visible: false,
      }).success,
    ).toBe(true);

    // Empty tabId, negative inset, and unknown keys are all rejected.
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        layout: { left: 0, top: 0, rightInset: 0, bottomInset: 0 },
        visible: false,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        layout: { left: 0, top: 0, rightInset: -1, bottomInset: 0 },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        layout: { left: 0, top: 0, rightInset: 0, bottomInset: 0 },
        visible: false,
        extra: true,
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
        layout: { left: 0.5, top: 0, rightInset: 0, bottomInset: 0 },
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
        layout: { left: 0, top: 0, rightInset: 0, bottomInset: 0 },
        visible: true,
      }).success,
    ).toBe(false);
  });
});

describe("isBlockedBrowserRequestHost (loopback / LAN firewall)", () => {
  it("blocks loopback hosts", () => {
    for (const host of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "localhost",
      "app.localhost",
      "::1",
      "[::1]",
      "::ffff:127.0.0.1",
    ]) {
      expect(isBlockedBrowserRequestHost(host)).toBe(true);
    }
  });

  it("blocks private, link-local, CGNAT, and mDNS hosts", () => {
    for (const host of [
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.10.10",
      "100.64.0.1",
      "printer.local",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedBrowserRequestHost(host)).toBe(true);
    }
  });

  it("allows public hosts and addresses", () => {
    for (const host of [
      "example.com",
      "github.com",
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1",
      "11.0.0.1",
      "100.63.0.1",
      "2606:4700:4700::1111",
    ]) {
      expect(isBlockedBrowserRequestHost(host)).toBe(false);
    }
  });
});

describe("isBlockedBrowserRequestUrl", () => {
  it("blocks requests to loopback/LAN over http(s)/ws(s)", () => {
    expect(isBlockedBrowserRequestUrl("http://127.0.0.1:38886/")).toBe(true);
    expect(isBlockedBrowserRequestUrl("https://127.0.0.1/x")).toBe(true);
    expect(isBlockedBrowserRequestUrl("ws://localhost:38886/ws")).toBe(true);
    expect(isBlockedBrowserRequestUrl("wss://10.0.0.5/socket")).toBe(true);
    expect(isBlockedBrowserRequestUrl("http://[::1]/")).toBe(true);
  });

  it("allows requests to public hosts and non-network schemes", () => {
    expect(isBlockedBrowserRequestUrl("https://example.com/")).toBe(false);
    expect(isBlockedBrowserRequestUrl("wss://example.com/socket")).toBe(false);
    expect(
      isBlockedBrowserRequestUrl("data:image/png;base64,iVBORw0KGgo="),
    ).toBe(false);
    expect(isBlockedBrowserRequestUrl("about:blank")).toBe(false);
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
