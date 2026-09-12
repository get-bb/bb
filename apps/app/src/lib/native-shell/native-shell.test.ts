// @vitest-environment jsdom

import {
  buildBridgeInjectionScript,
  parsePageToShellMessage,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNativeShell,
  isInsideNativeShell,
  resetNativeShellForTests,
  shellOpenExternal,
} from "./native-shell";

const handshake: NativeShellHandshake = {
  bridgeVersion: 1,
  appVersion: "0.39.0",
  platform: "ios",
  profileMode: "connect",
  secureContext: true,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  capabilities: ["haptic", "badge", "share", "open-external", "safe-area"],
};

const posted: string[] = [];

function installShell(overrides: Partial<NativeShellHandshake> = {}): void {
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: {
      postMessage: (raw: string) => {
        posted.push(raw);
      },
    },
  });
  // eslint-disable-next-line no-new-func
  new Function(
    "window",
    buildBridgeInjectionScript({ ...handshake, ...overrides }),
  )(window);
  resetNativeShellForTests();
}

function lastMessage(): unknown {
  const raw = posted.at(-1);
  const parsed = parsePageToShellMessage(raw);
  if (!parsed.ok) throw new Error(`shell could not parse: ${parsed.reason}`);
  return parsed.message;
}

beforeEach(() => {
  posted.length = 0;
  resetNativeShellForTests();
});

afterEach(() => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "bb");
  Reflect.deleteProperty(
    window as unknown as Record<string, unknown>,
    "ReactNativeWebView",
  );
  resetNativeShellForTests();
  vi.restoreAllMocks();
});

describe("getNativeShell", () => {
  it("reads the handshake the shell installed", () => {
    installShell();
    const shell = getNativeShell();
    expect(shell).not.toBeNull();
    expect(shell?.handshake.profileMode).toBe("connect");
    expect(shell?.safeArea()).toEqual({
      top: 59,
      right: 0,
      bottom: 34,
      left: 0,
    });
    expect(isInsideNativeShell()).toBe(true);
  });

  it("reports no shell in a plain browser", () => {
    expect(getNativeShell()).toBeNull();
    expect(isInsideNativeShell()).toBe(false);
  });

  it("ignores a global that is not a usable bridge", () => {
    Object.defineProperty(window, "bb", {
      configurable: true,
      value: { native: { post: "not a function" } },
    });
    expect(getNativeShell()).toBeNull();
  });

  it("treats a nonsense bridge version as no bridge", () => {
    installShell({ bridgeVersion: 0 });
    expect(getNativeShell()).toBeNull();
  });

  it("keeps working with a shell newer than this page", () => {
    installShell({ bridgeVersion: 99 });
    expect(getNativeShell()).not.toBeNull();
  });
});

describe("shellOpenExternal", () => {
  it("hands the link to the shell and says it took it", () => {
    installShell();
    expect(shellOpenExternal("https://example.com/docs")).toBe(true);
    expect(lastMessage()).toEqual({
      type: "open-external",
      url: "https://example.com/docs",
    });
  });

  it("declines in a plain browser so the caller can use window.open", () => {
    expect(shellOpenExternal("https://example.com/docs")).toBe(false);
  });
});
