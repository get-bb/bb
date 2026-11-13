import { describe, expect, it } from "vitest";
import {
  parseBridgeServers,
  parsePageToShellMessage,
  parseNativeShellHandshake,
  parseShellToPageEvent,
  type NativeShellHandshake,
} from "../src/index.js";

function json(value: unknown): string {
  return JSON.stringify(value);
}

const handshake: NativeShellHandshake = {
  bridgeVersion: 2,
  appVersion: "0.39.0",
  platform: "ios",
  profileMode: "connect",
  secureContext: true,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  capabilities: [
    "haptic",
    "badge",
    "share",
    "open-external",
    "safe-area",
    "open-native",
  ],
};

describe("parsePageToShellMessage", () => {
  it("accepts every message kind the contract defines", () => {
    const cases: unknown[] = [
      { type: "ready", path: "/threads/thr_1" },
      { type: "title", title: "bb", path: "/" },
      { type: "haptic", kind: "impact-medium" },
      { type: "badge", count: 0 },
      { type: "open-external", url: "https://example.com/docs" },
      { type: "open-native", screen: "device-settings" },
      { type: "switch-server", id: "profile-2" },
      ...[true, false].map((expanded) => ({
        type: "request",
        id: "rail-toggle",
        request: { kind: "set-rail-expanded", payload: { expanded } },
      })),
      {
        type: "request",
        id: "r1-app",
        request: {
          kind: "open-application",
          payload: { url: "reflect://note/Project%20X" },
        },
      },
      {
        type: "request",
        id: "r1-2",
        request: {
          kind: "share",
          payload: { url: "https://bee.getbb.app/threads/thr_1" },
        },
      },
    ];
    for (const value of cases) {
      const parsed = parsePageToShellMessage(json(value));
      expect(parsed.ok, JSON.stringify(value)).toBe(true);
    }
  });

  it("rejects malformed rail requests instead of coercing restore into expand", () => {
    for (const payload of [
      { expanded: "false" },
      {},
      { expanded: true, setting: "top" },
    ]) {
      expect(
        parsePageToShellMessage(
          json({
            type: "request",
            id: "rail-toggle",
            request: { kind: "set-rail-expanded", payload },
          }),
        ).ok,
      ).toBe(false);
    }
  });

  it("rejects a payload that is not a JSON string", () => {
    expect(parsePageToShellMessage({ type: "ready", path: "/" })).toEqual({
      ok: false,
      reason: "message was not a string",
    });
    expect(parsePageToShellMessage("not json").ok).toBe(false);
  });

  it("drops a message type an older shell does not know", () => {
    const parsed = parsePageToShellMessage(
      json({ type: "open-camera", lens: "front" }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("refuses a native screen the shell does not own", () => {
    expect(
      parsePageToShellMessage(
        json({ type: "open-native", screen: "/settings/servers" }),
      ).ok,
    ).toBe(false);
    expect(
      parsePageToShellMessage(json({ type: "open-native", screen: "" })).ok,
    ).toBe(false);
  });

  it("rejects extra fields so a typo never travels silently", () => {
    const parsed = parsePageToShellMessage(
      json({ type: "badge", count: 3, colour: "red" }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("rejects a badge count that is negative or fractional", () => {
    expect(parsePageToShellMessage(json({ type: "badge", count: -1 })).ok).toBe(
      false,
    );
    expect(
      parsePageToShellMessage(json({ type: "badge", count: 1.5 })).ok,
    ).toBe(false);
  });

  it("refuses any external link that is not http or https", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "bb://settings",
      "not a url",
    ]) {
      expect(
        parsePageToShellMessage(json({ type: "open-external", url })).ok,
        url,
      ).toBe(false);
    }
    expect(
      parsePageToShellMessage(
        json({ type: "open-external", url: "https://example.com/docs" }),
      ).ok,
    ).toBe(true);
  });

  it("applies the same rule to a share url", () => {
    expect(
      parsePageToShellMessage(
        json({
          type: "request",
          id: "r1",
          request: { kind: "share", payload: { url: "javascript:alert(1)" } },
        }),
      ).ok,
    ).toBe(false);
  });

  it("requires a share to carry text or a url", () => {
    expect(
      parsePageToShellMessage(
        json({
          type: "request",
          id: "r1",
          request: { kind: "share", payload: { title: "bb" } },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe("parseNativeShellHandshake", () => {
  it("accepts the handshake the shell injects", () => {
    expect(parseNativeShellHandshake(handshake)).toEqual(handshake);
    const android = {
      ...handshake,
      platform: "android",
      androidVersionCode: 4,
    };
    expect(parseNativeShellHandshake(android)).toEqual(android);
    for (const androidVersionCode of [0, -1, 1.5, "4"]) {
      expect(
        parseNativeShellHandshake({ ...android, androidVersionCode }),
      ).toBeNull();
    }
  });

  it("reads a malformed or absent bridge as no bridge", () => {
    expect(parseNativeShellHandshake(undefined)).toBeNull();
    expect(parseNativeShellHandshake({})).toBeNull();
    expect(
      parseNativeShellHandshake({ ...handshake, safeArea: { top: 1 } }),
    ).toBeNull();
    expect(
      parseNativeShellHandshake({ ...handshake, capabilities: ["teleport"] }),
    ).toBeNull();
  });
});

describe("native download support", () => {
  it("advertises native downloads without extending the capability enum", () => {
    const supported = { ...handshake, nativeDownloads: true };
    expect(parseNativeShellHandshake(supported)).toEqual(supported);
    expect(parseNativeShellHandshake(handshake)).toEqual(handshake);
    expect(
      parseNativeShellHandshake({ ...handshake, nativeDownloads: "true" }),
    ).toBeNull();
    expect(
      parseNativeShellHandshake({
        ...handshake,
        capabilities: ["native-downloads"],
      }),
    ).toBeNull();
  });
});

const DUO_COVER_BAR_OFF = {
  verticalBar: { edge: "none", behavior: "disabled" },
  occlusions: [
    { x: 399.67, y: 29.33, width: 37, height: 37 },
    { x: 266, y: 0, width: 200, height: 82 },
  ],
} as const;

describe("shell window layout", () => {
  it("accepts the window layout as an optional handshake field", () => {
    const withLayout = { ...handshake, windowLayout: DUO_COVER_BAR_OFF };
    expect(parseNativeShellHandshake(withLayout)).toEqual(withLayout);
    expect(parseNativeShellHandshake(handshake)).toEqual(handshake);
  });

  it("rejects an unknown edge or behavior, a negative size and extra fields", () => {
    for (const windowLayout of [
      {
        ...DUO_COVER_BAR_OFF,
        verticalBar: { edge: "top", behavior: "disabled" },
      },
      {
        ...DUO_COVER_BAR_OFF,
        verticalBar: { edge: "none", behavior: "hidden" },
      },
      {
        ...DUO_COVER_BAR_OFF,
        occlusions: [{ x: 0, y: 0, width: -1, height: 1 }],
      },
      { ...DUO_COVER_BAR_OFF, statusBar: "top" },
    ]) {
      expect(
        parseNativeShellHandshake({ ...handshake, windowLayout }),
        JSON.stringify(windowLayout),
      ).toBeNull();
    }
  });

  it("parses the window-layout event and drops malformed ones", () => {
    const event = { type: "window-layout", windowLayout: DUO_COVER_BAR_OFF };
    expect(parseShellToPageEvent(event)).toEqual(event);
    expect(
      parseShellToPageEvent({
        type: "window-layout",
        windowLayout: "disabled",
      }),
    ).toBeNull();
  });
});

describe("server lists", () => {
  const server = {
    id: "profile-1",
    name: "Studio",
    origin: "https://studio.getbb.app",
    kind: "account",
    active: true,
  };

  it("reads a list the shell injects and treats any malformed entry as no list", () => {
    expect(parseBridgeServers([server])).toEqual([server]);
    expect(parseBridgeServers(undefined)).toBeNull();
    expect(parseBridgeServers([{ ...server, kind: "teleport" }])).toBeNull();
    expect(
      parseBridgeServers([
        { ...server, url: "https://user:password@studio.getbb.app" },
      ]),
    ).toBeNull();
  });
});
