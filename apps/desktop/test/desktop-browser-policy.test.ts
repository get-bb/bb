import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserStateSchema,
  bbDesktopPopoutMouseEventsIgnoredRequestSchema,
  bbDesktopPopoutThreadChangedPayloadSchema,
  bbDesktopPopoutThreadRefSchema,
} from "@bb/server-contract";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  isAllowedTrustedLocalTopLevelUrl,
  isBlockedBrowserRequestHost,
  isBlockedBrowserRequestUrl,
  isLoopbackBrowserRequestHost,
  isPrivateBrowserRequestHost,
  localRequestOriginKey,
  resolveWindowOpenAction,
  shouldBlockBrowserRequest,
  type ShouldBlockBrowserRequestArgs,
} from "../src/desktop-browser-policy.js";

function requireLocalOriginKey(url: string): string {
  const key = localRequestOriginKey(url);
  if (key === null) {
    throw new Error(`Expected local origin key for ${url}`);
  }
  return key;
}

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

  it("denies loopback and private popups (no new tab)", () => {
    for (const url of [
      "http://localhost:5173/",
      "https://app.localhost/path",
      "http://127.0.0.1:38886/",
      "http://[::1]:5173/",
      "http://192.168.1.1/",
      "http://printer.local/",
    ]) {
      expect(resolveWindowOpenAction(url)).toEqual({ openTabUrl: null });
    }
  });
});

describe("browser IPC payload schemas", () => {
  // The desktop shell hosts whatever SPA the probed bb server serves (no
  // version handshake), so these request shapes are wire-frozen: they must
  // keep accepting exactly the historical bounds-only payloads.
  it("accepts a well-formed attach request and rejects bad shapes", () => {
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(true);

    // Empty tabId, negative size, and unknown keys are all rejected.
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
    // A layout descriptor never crosses the IPC boundary; older shells'
    // strict parsers would drop the whole request if a renderer sent one.
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

describe("popout IPC payload schemas", () => {
  it("accepts only strict thread references and nullable thread changes", () => {
    const threadRef = {
      projectId: "proj_abc",
      threadId: "thr_abc",
    };

    expect(bbDesktopPopoutThreadRefSchema.safeParse(threadRef).success).toBe(
      true,
    );
    expect(
      bbDesktopPopoutThreadChangedPayloadSchema.safeParse(threadRef).success,
    ).toBe(true);
    expect(
      bbDesktopPopoutThreadChangedPayloadSchema.safeParse(null).success,
    ).toBe(true);
    expect(
      bbDesktopPopoutThreadRefSchema.safeParse({
        ...threadRef,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopPopoutThreadRefSchema.safeParse({
        projectId: "",
        threadId: "thr_abc",
      }).success,
    ).toBe(false);
  });

  it("accepts only strict mouse passthrough requests", () => {
    expect(
      bbDesktopPopoutMouseEventsIgnoredRequestSchema.safeParse({
        ignore: true,
      }).success,
    ).toBe(true);
    expect(
      bbDesktopPopoutMouseEventsIgnoredRequestSchema.safeParse({
        ignore: true,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopPopoutMouseEventsIgnoredRequestSchema.safeParse({
        ignore: "true",
      }).success,
    ).toBe(false);
  });
});

describe("browser request host classification", () => {
  it("detects only loopback hosts with localhost names and literals", () => {
    for (const host of [
      "127.0.0.1",
      "127.1.2.3",
      "localhost",
      "localhost.",
      "app.localhost",
      "deep.app.localhost",
      "::1",
      "[::1]",
    ]) {
      expect(isLoopbackBrowserRequestHost(host)).toBe(true);
    }

    for (const host of [
      "0.0.0.0",
      "10.0.0.1",
      "192.168.1.1",
      "printer.local",
      "example.com",
      "8.8.8.8",
      "::",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isLoopbackBrowserRequestHost(host)).toBe(false);
    }
  });

  it("detects private, LAN, link-local, mDNS, CGNAT, reserved, and unspecified hosts", () => {
    for (const host of [
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.10.10",
      "100.64.0.1",
      "printer.local",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "192.0.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateBrowserRequestHost(host)).toBe(true);
    }

    for (const host of [
      "localhost",
      "app.localhost",
      "127.0.0.1",
      "::1",
      "example.com",
      "8.8.8.8",
      "172.32.0.1",
      "11.0.0.1",
      "100.63.0.1",
      "2606:4700:4700::1111",
    ]) {
      expect(isPrivateBrowserRequestHost(host)).toBe(false);
    }
  });

  it("combines loopback and private classification for the coarse firewall", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "app.localhost",
      "::1",
      "::ffff:127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "printer.local",
    ]) {
      expect(isBlockedBrowserRequestHost(host)).toBe(true);
    }

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
    expect(isBlockedBrowserRequestUrl("http://0.0.0.0:38886/")).toBe(true);
    expect(isBlockedBrowserRequestUrl("https://0.0.0.0/")).toBe(true);
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

describe("localRequestOriginKey", () => {
  it("returns comparable same-transport keys for loopback http(s) and ws(s)", () => {
    expect(localRequestOriginKey("http://localhost:5173/path")).toBe(
      localRequestOriginKey("ws://localhost:5173/socket"),
    );
    expect(localRequestOriginKey("https://localhost/")).toBe(
      localRequestOriginKey("wss://localhost/updates"),
    );
    expect(localRequestOriginKey("http://localhost:80/")).toBe(
      localRequestOriginKey("ws://localhost/"),
    );
  });

  it("keeps scheme class, host, and port in the local origin key", () => {
    expect(localRequestOriginKey("http://localhost:5173/")).not.toBe(
      localRequestOriginKey("https://localhost:5173/"),
    );
    expect(localRequestOriginKey("http://localhost:5173/")).not.toBe(
      localRequestOriginKey("http://localhost:38886/"),
    );
    expect(localRequestOriginKey("http://localhost:5173/")).not.toBe(
      localRequestOriginKey("http://127.0.0.1:5173/"),
    );
    expect(localRequestOriginKey("http://localhost.:5173/")).not.toBe(
      localRequestOriginKey("http://localhost:5173/"),
    );
    expect(localRequestOriginKey("http://app.localhost.:5173/")).not.toBe(
      localRequestOriginKey("http://app.localhost:5173/"),
    );
  });

  it("returns null for public, private, and unsupported URLs", () => {
    expect(localRequestOriginKey("https://example.com/")).toBeNull();
    expect(localRequestOriginKey("http://0.0.0.0:5173/")).toBeNull();
    expect(localRequestOriginKey("http://192.168.1.1/")).toBeNull();
    expect(localRequestOriginKey("file:///etc/passwd")).toBeNull();
  });
});

describe("isAllowedTrustedLocalTopLevelUrl", () => {
  it("allows only loopback http(s) top-level URLs", () => {
    expect(isAllowedTrustedLocalTopLevelUrl("http://localhost:5173/")).toBe(
      true,
    );
    expect(isAllowedTrustedLocalTopLevelUrl("https://app.localhost/")).toBe(
      true,
    );
    expect(isAllowedTrustedLocalTopLevelUrl("http://127.0.0.1:3000/")).toBe(
      true,
    );
    expect(isAllowedTrustedLocalTopLevelUrl("http://[::1]:5173/")).toBe(true);

    expect(isAllowedTrustedLocalTopLevelUrl("ws://localhost:5173/ws")).toBe(
      false,
    );
    expect(isAllowedTrustedLocalTopLevelUrl("https://example.com/")).toBe(
      false,
    );
    expect(isAllowedTrustedLocalTopLevelUrl("http://0.0.0.0:5173/")).toBe(
      false,
    );
    expect(isAllowedTrustedLocalTopLevelUrl("http://192.168.1.1/")).toBe(false);
  });
});

describe("shouldBlockBrowserRequest", () => {
  const localhost3000 = requireLocalOriginKey("http://localhost:3000/");
  const localhost5173 = requireLocalOriginKey("http://localhost:5173/");
  const localhostSecure3000 = requireLocalOriginKey("https://localhost:3000/");
  const loopbackIpv4 = requireLocalOriginKey("http://127.0.0.1:3000/");

  const baseRequest: ShouldBlockBrowserRequestArgs = {
    url: "http://localhost:3000/",
    resourceType: "mainFrame",
    isMainFrame: true,
    targetWebContentsId: 1,
    entryWebContentsId: 1,
    pendingTrustedLocalTopLevelOriginKey: null,
    currentMainFrameLocalOriginKey: null,
    requestingFrameOriginKey: null,
    mainFrameInitiatorOriginKey: null,
  };

  it("allows public requests regardless of local attribution fields", () => {
    expect(
      shouldBlockBrowserRequest({
        ...baseRequest,
        url: "https://example.com/app.js",
        resourceType: "script",
        isMainFrame: false,
        targetWebContentsId: null,
        entryWebContentsId: null,
        pendingTrustedLocalTopLevelOriginKey: localhost3000,
        currentMainFrameLocalOriginKey: localhost3000,
        requestingFrameOriginKey: null,
      }),
    ).toBe(false);

    expect(
      shouldBlockBrowserRequest({
        ...baseRequest,
        url: "wss://example.com/socket",
        resourceType: "webSocket",
        isMainFrame: false,
        targetWebContentsId: 2,
        entryWebContentsId: 1,
      }),
    ).toBe(false);
  });

  it("blocks explicit 0.0.0.0 firewall targets", () => {
    for (const url of ["http://0.0.0.0:38886/", "https://0.0.0.0/"]) {
      expect(shouldBlockBrowserRequest({ ...baseRequest, url })).toBe(true);
    }
  });

  it("allows trusted pending loopback main-frame requests without an initiator", () => {
    expect(
      shouldBlockBrowserRequest({
        ...baseRequest,
        pendingTrustedLocalTopLevelOriginKey: localhost3000,
      }),
    ).toBe(false);
  });

  it("allows current same-origin loopback main-frame requests only from a matching local initiator", () => {
    expect(
      shouldBlockBrowserRequest({
        ...baseRequest,
        isMainFrame: false,
        resourceType: "mainFrame",
        currentMainFrameLocalOriginKey: localhost3000,
        mainFrameInitiatorOriginKey: localhost3000,
      }),
    ).toBe(false);

    for (const mainFrameInitiatorOriginKey of [
      null,
      localRequestOriginKey("https://example.com/"),
      localhost5173,
      localhostSecure3000,
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          currentMainFrameLocalOriginKey: localhost3000,
          mainFrameInitiatorOriginKey,
        }),
      ).toBe(true);
    }
  });

  it("blocks unapproved loopback requests", () => {
    for (const resourceType of [
      "mainFrame",
      "subFrame",
      "script",
      "xhr",
      "image",
      "webSocket",
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          resourceType,
          isMainFrame: resourceType === "mainFrame",
        }),
      ).toBe(true);
    }
  });

  it("allows same-origin loopback subresources and WebSockets from the committed local frame", () => {
    for (const request of [
      { url: "http://localhost:3000/app.js", resourceType: "script" },
      { url: "ws://localhost:3000/socket", resourceType: "webSocket" },
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          url: request.url,
          resourceType: request.resourceType,
          isMainFrame: false,
          currentMainFrameLocalOriginKey: localhost3000,
          requestingFrameOriginKey: localhost3000,
        }),
      ).toBe(false);
    }
  });

  it("isolates local approval by attributed webContents id", () => {
    expect(
      shouldBlockBrowserRequest({
        ...baseRequest,
        pendingTrustedLocalTopLevelOriginKey: localhost3000,
        targetWebContentsId: 2,
        entryWebContentsId: 1,
      }),
    ).toBe(true);
  });

  it("blocks local requests with missing or mismatched attribution", () => {
    for (const request of [
      { targetWebContentsId: null, entryWebContentsId: 1 },
      { targetWebContentsId: 1, entryWebContentsId: null },
      { targetWebContentsId: 2, entryWebContentsId: 1 },
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          targetWebContentsId: request.targetWebContentsId,
          entryWebContentsId: request.entryWebContentsId,
          pendingTrustedLocalTopLevelOriginKey: localhost3000,
        }),
      ).toBe(true);
    }
  });

  it("blocks non-main-frame local requests with missing, public, or mismatched requesting frame origin", () => {
    for (const requestingFrameOriginKey of [
      null,
      localRequestOriginKey("https://example.com/"),
      localhost5173,
      localhostSecure3000,
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          url: "http://localhost:3000/app.js",
          resourceType: "script",
          isMainFrame: false,
          currentMainFrameLocalOriginKey: localhost3000,
          requestingFrameOriginKey,
        }),
      ).toBe(true);
    }
  });

  it("blocks cross-origin loopback requests from a committed local page", () => {
    for (const url of [
      "http://localhost:5173/api",
      "http://127.0.0.1:3000/api",
      "https://localhost:3000/api",
      "http://localhost.:3000/api",
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          url,
          resourceType: "xhr",
          isMainFrame: false,
          currentMainFrameLocalOriginKey: localhost3000,
          requestingFrameOriginKey: localhost3000,
        }),
      ).toBe(true);
    }

    expect(loopbackIpv4).not.toBe(localhost3000);
  });

  it("blocks private requests even when attribution and frame origin are present", () => {
    for (const url of [
      "http://192.168.1.1/",
      "http://printer.local/",
      "http://100.64.0.1/",
      "http://[fe80::1]/",
    ]) {
      expect(
        shouldBlockBrowserRequest({
          ...baseRequest,
          url,
          resourceType: "image",
          isMainFrame: false,
          currentMainFrameLocalOriginKey: localhost3000,
          requestingFrameOriginKey: localhost3000,
        }),
      ).toBe(true);
    }
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
