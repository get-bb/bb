// @vitest-environment jsdom

import {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  parsePageToShellMessage,
  type NativeCapability,
} from "@bb/mobile-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetNativeShellForTests } from "@/lib/native-shell";
import {
  adoptNativeShellDeviceOnce,
  resetNativeDeviceAdoptionForTests,
} from "./native-device-adoption";

const posted: string[] = [];

function installShell(capabilities: NativeCapability[]): void {
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage: (raw: string) => posted.push(raw) },
  });
  new Function(
    "window",
    buildBridgeInjectionScript({
      bridgeVersion: 6,
      appVersion: "0.40.0",
      platform: "ios",
      profileMode: "direct",
      secureContext: true,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      capabilities,
    }),
  )(window);
  resetNativeShellForTests();
}

function stubPairingServer(): string[] {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), "http://bb.test"), init);
      paths.push(`${request.method} ${new URL(request.url).pathname}`);
      return Response.json({ code: "ABCDE-FGHJK", expiresAt: 1 });
    }),
  );
  return paths;
}

afterEach(() => {
  posted.length = 0;
  Reflect.deleteProperty(window, "ReactNativeWebView");
  resetNativeShellForTests();
  resetNativeDeviceAdoptionForTests();
  vi.unstubAllGlobals();
});

describe("adopting the mobile app's device key from a signed-in web view", () => {
  it("hands the app a fresh pairing code to redeem with its own key", async () => {
    installShell(["open-native", "device-adopt"]);
    const paths = stubPairingServer();
    const adopted = adoptNativeShellDeviceOnce();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    const parsed = parsePageToShellMessage(posted[0]);
    if (!parsed.ok || parsed.message.type !== "request") {
      throw new Error("expected a native request");
    }
    expect(parsed.message.request).toEqual({
      kind: "adopt-device",
      payload: { code: "ABCDE-FGHJK" },
    });
    new Function(
      "window",
      buildBridgeEventScript({
        type: "response",
        id: parsed.message.id,
        response: { ok: true, result: { adopted: true } },
      }),
    )(window);
    expect(await adopted).toBe(true);
    expect(await adoptNativeShellDeviceOnce()).toBe(true);
    expect(paths).toEqual(["POST /api/v1/access/pairings"]);
  });

  it("makes no pairing code when the app already has a device key", async () => {
    installShell(["open-native", "device-sign-in"]);
    const paths = stubPairingServer();
    expect(await adoptNativeShellDeviceOnce()).toBe(false);
    expect(paths).toEqual([]);
    expect(posted).toEqual([]);
  });
});
