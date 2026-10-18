// @vitest-environment jsdom

import {
  buildBridgeInjectionScript,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNativeShellForTests } from "@/lib/native-shell/native-shell";
import { canSaveFileNatively, saveFile } from "./save-file";

const mocks = vi.hoisted(() => ({ error: vi.fn(), postMessage: vi.fn() }));
vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: mocks.error },
}));

const handshake: NativeShellHandshake = {
  bridgeVersion: 2,
  appVersion: "0.39.0",
  platform: "ios",
  profileMode: "direct",
  secureContext: true,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  capabilities: ["share"],
  nativeDownloads: true,
};

const anchorClicks: { href: string; download: string }[] = [];

function installShell(nativeDownloads: true | undefined): void {
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage: mocks.postMessage },
  });
  // eslint-disable-next-line no-new-func
  new Function(
    "window",
    buildBridgeInjectionScript({ ...handshake, nativeDownloads }),
  )(window);
  resetNativeShellForTests();
}

beforeEach(() => {
  vi.useFakeTimers();
  anchorClicks.length = 0;
  mocks.error.mockReset();
  mocks.postMessage.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchorClicks.push({ href: this.href, download: this.download });
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:http://localhost:3000/object");
      static revokeObjectURL = vi.fn();
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "bb");
  Reflect.deleteProperty(window, "ReactNativeWebView");
  resetNativeShellForTests();
});

describe("saveFile", () => {
  it.each(["web", "old-shell", "native-downloads"])(
    "starts a server download in %s without transferring bytes or cookies",
    async (mode) => {
      if (mode !== "web")
        installShell(mode === "native-downloads" ? true : undefined);
      expect(canSaveFileNatively()).toBe(mode === "native-downloads");
      await expect(
        saveFile({ url: "/api/v1/files/notes.zip", fileName: "notes.zip" }),
      ).resolves.toBe("started");
      expect(anchorClicks).toEqual([
        {
          href: `${window.location.origin}/api/v1/files/notes.zip`,
          download: "notes.zip",
        },
      ]);
      expect(mocks.postMessage).not.toHaveBeenCalled();
      expect(document.querySelector("a[download]")).toBeNull();
    },
  );

  it("keeps a blob URL alive until WebKit has time to consume it", async () => {
    installShell(true);
    await expect(
      saveFile({ blob: new Blob(["hello"]), fileName: "voice.webm" }),
    ).resolves.toBe("started");
    expect(anchorClicks).toEqual([
      { href: "blob:http://localhost:3000/object", download: "voice.webm" },
    ]);
    expect(mocks.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:http://localhost:3000/object",
    );
  });

  it("reports a failure to start and removes the temporary anchor", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(
      saveFile({ blob: new Blob(["hello"]), fileName: "note.txt" }),
    ).resolves.toBe("failed");
    expect(mocks.error).toHaveBeenCalledWith("Couldn't save note.txt", {
      description: "blocked",
    });
    expect(document.querySelector("a[download]")).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
