// @vitest-environment jsdom

import {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  parsePageToShellMessage,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetNativeShellForTests } from "@/lib/native-shell";
import { PairingScreen } from "./PairingScreen";

const posted: string[] = [];

function installDirectShell(): void {
  const handshake: NativeShellHandshake = {
    bridgeVersion: 5,
    appVersion: "0.40.0",
    platform: "ios",
    profileMode: "direct",
    secureContext: false,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    capabilities: ["open-native", "device-sign-in"],
  };
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage: (raw: string) => posted.push(raw) },
  });
  new Function("window", buildBridgeInjectionScript(handshake))(window);
  resetNativeShellForTests();
}

function answerRenewal(renewed: boolean): void {
  const parsed = parsePageToShellMessage(posted.at(-1));
  if (!parsed.ok || parsed.message.type !== "request") {
    throw new Error("expected a native request");
  }
  expect(parsed.message.request).toEqual({
    kind: "renew-session",
    payload: {},
  });
  new Function(
    "window",
    buildBridgeEventScript({
      type: "response",
      id: parsed.message.id,
      response: { ok: true, result: { renewed } },
    }),
  )(window);
}

afterEach(() => {
  cleanup();
  posted.length = 0;
  Reflect.deleteProperty(window, "ReactNativeWebView");
  resetNativeShellForTests();
  vi.restoreAllMocks();
});

describe("PairingScreen inside a device-signed-in mobile shell", () => {
  it("asks the app to renew the web view's session instead of taking a code", async () => {
    installDirectShell();
    const replace = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      pathname: "/threads/thr_1",
      search: "",
      replace,
    });
    render(<PairingScreen reason="unauthenticated" />);
    expect(screen.queryByLabelText("Pairing code")).toBeNull();
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    answerRenewal(true);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/threads/thr_1"));
  });

  it("points to the app's own sign-in when the device was signed out", async () => {
    installDirectShell();
    render(<PairingScreen reason="unauthenticated" />);
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    answerRenewal(false);
    expect(await screen.findByText("Sign in again from the app")).toBeTruthy();
  });
});
