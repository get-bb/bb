import { describe, expect, it, vi } from "vitest";
import {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  parsePageToShellMessage,
  type NativeShellApi,
  type NativeShellHandshake,
} from "../src/index.js";

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

interface FakeWindow {
  location: { href: string };
  ReactNativeWebView: { postMessage(raw: string): void };
  bb?: { native?: NativeShellApi };
}

function installBridge(
  overrides: Partial<NativeShellHandshake> = {},
  page: Record<string, unknown> = {},
) {
  const posted: string[] = [];
  const fakeWindow: FakeWindow = {
    location: { href: "https://test/threads/one" },
    ReactNativeWebView: {
      postMessage: (raw: string) => {
        posted.push(raw);
      },
    },
  };
  const run = (script: string) => {
    // eslint-disable-next-line no-new-func
    new Function(
      "window",
      "document",
      "DataTransfer",
      "ClipboardEvent",
      script,
    )(fakeWindow, page.document, page.DataTransfer, page.ClipboardEvent);
  };
  run(buildBridgeInjectionScript({ ...handshake, ...overrides }));
  const native = fakeWindow.bb?.native;
  if (native === undefined) throw new Error("bridge did not install");
  return { native, posted, run, fakeWindow };
}

describe("buildBridgeInjectionScript", () => {
  it("installs the handshake the page reads at boot", () => {
    const { native } = installBridge();
    expect(native.bridgeVersion).toBe(2);
    expect(native.platform).toBe("ios");
    expect(native.profileMode).toBe("connect");
    expect(native.safeArea).toEqual({ top: 59, right: 0, bottom: 34, left: 0 });
    expect(native.capabilities).toContain("share");
  });

  it("posts a request the shell can parse, and resolves it on the reply", async () => {
    const { native, posted, run } = installBridge();
    const promise = native.request("share", {
      url: "https://bee.getbb.app/threads/thr_1",
    });
    const parsed = parsePageToShellMessage(posted[0]);
    if (!parsed.ok) throw new Error(`shell could not parse: ${parsed.reason}`);
    if (parsed.message.type !== "request") throw new Error("wrong type");
    const { id } = parsed.message;
    run(
      buildBridgeEventScript({
        type: "response",
        id,
        response: { ok: true, result: { shared: true } },
      }),
    );
    await expect(promise).resolves.toEqual({ shared: true });
  });

  it("rejects a request the shell could not perform", async () => {
    const { native, posted, run } = installBridge();
    const promise = native.request("share", { text: "hello" });
    const parsed = parsePageToShellMessage(posted[0]);
    if (!parsed.ok || parsed.message.type !== "request") {
      throw new Error("unexpected message");
    }
    run(
      buildBridgeEventScript({
        type: "response",
        id: parsed.message.id,
        response: { ok: false, error: "share sheet unavailable" },
      }),
    );
    await expect(promise).rejects.toThrow("share sheet unavailable");
  });

  it("times out a request the shell never answers", async () => {
    vi.useFakeTimers();
    try {
      const { native } = installBridge();
      const promise = native.request("share", { text: "hello" });
      const assertion = expect(promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates the safe area and notifies subscribers on rotation", () => {
    const { native, run } = installBridge();
    const seen: unknown[] = [];
    const unsubscribe = native.subscribe((event: unknown) => seen.push(event));
    run(
      buildBridgeEventScript({
        type: "safe-area",
        safeArea: { top: 0, right: 59, bottom: 21, left: 59 },
      }),
    );
    expect(native.safeArea).toEqual({
      top: 0,
      right: 59,
      bottom: 21,
      left: 59,
    });
    expect(seen).toHaveLength(1);
    unsubscribe();
    run(buildBridgeEventScript({ type: "resume" }));
    expect(seen).toHaveLength(1);
  });

  it("re-applies the handshake instead of installing twice", () => {
    const { native, run, fakeWindow } = installBridge();
    const seen: unknown[] = [];
    native.subscribe((event: unknown) => seen.push(event));
    run(
      buildBridgeInjectionScript({
        ...handshake,
        appVersion: "0.40.0",
        safeArea: { top: 10, right: 0, bottom: 0, left: 0 },
      }),
    );
    expect(fakeWindow.bb?.native).toBe(native);
    expect(native.appVersion).toBe("0.40.0");
    run(buildBridgeEventScript({ type: "resume" }));
    expect(seen).toHaveLength(1);
  });

  it("escapes a handshake value that would close the script tag", () => {
    const script = buildBridgeInjectionScript({
      ...handshake,
      appVersion: "</script><script>alert(1)</script>",
    });
    expect(script).not.toContain("</script>");
  });

  it("survives a page with no ReactNativeWebView", () => {
    const fakeWindow: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function("window", buildBridgeInjectionScript(handshake))(fakeWindow);
    const native = (fakeWindow.bb as { native: NativeShellApi }).native;
    expect(() => native.post({ type: "ready", path: "/" })).not.toThrow();
  });
});

interface ImagePasteApi extends NativeShellApi {
  __beginImagePaste(id: string): boolean;
  __finishImagePaste(
    id: string,
    image: { data: string; name: string; type: string } | null,
  ): void;
}

function installImageBridge() {
  const dispatchEvent = vi.fn();
  const target = {
    isContentEditable: true,
    isConnected: true,
    closest: vi.fn<() => object | null>(() => ({})),
    dispatchEvent,
  };
  const document = { activeElement: target };
  class Transfer {
    files: File[] = [];
    items = { add: (file: File) => this.files.push(file) };
  }
  class Paste {
    constructor(
      public type: string,
      public options: { clipboardData: Transfer },
    ) {}
  }
  const { native, fakeWindow } = installBridge(
    { platform: "android" },
    { document, DataTransfer: Transfer, ClipboardEvent: Paste },
  );
  return {
    native: native as ImagePasteApi,
    document,
    target,
    dispatchEvent,
    fakeWindow,
  };
}

const image = { data: "AAECA/8=", name: "screenshot.png", type: "image/png" };

describe("native keyboard image paste", () => {
  it("delivers the image bytes and metadata through the original editor's paste handler", async () => {
    const { native, document, dispatchEvent } = installImageBridge();
    expect(native.__beginImagePaste("image")).toBe(true);
    document.activeElement = {
      ...document.activeElement,
      dispatchEvent: vi.fn(),
    };
    native.__finishImagePaste("image", image);
    const event = dispatchEvent.mock.calls[0]?.[0];
    expect(event.type).toBe("paste");
    const file: File = event.options.clipboardData.files[0];
    expect(file.name).toBe("screenshot.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 3, 255]),
    );
    native.__finishImagePaste("image", image);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects text inputs and ignores images after the editor is removed", () => {
    const { native, target, dispatchEvent } = installImageBridge();
    target.closest.mockReturnValueOnce(null);
    expect(native.__beginImagePaste("outside")).toBe(false);
    target.isContentEditable = false;
    expect(native.__beginImagePaste("text")).toBe(false);
    target.isContentEditable = true;
    expect(native.__beginImagePaste("gone")).toBe(true);
    target.isConnected = false;
    native.__finishImagePaste("gone", image);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("discards images when navigation reuses the same editor element", () => {
    const { native, fakeWindow, dispatchEvent } = installImageBridge();
    native.__beginImagePaste("navigation");
    fakeWindow.location.href = "https://test/threads/two";
    native.__finishImagePaste("navigation", image);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("discards failed and expired image reads", () => {
    vi.useFakeTimers();
    try {
      const { native, dispatchEvent } = installImageBridge();
      native.__beginImagePaste("failed");
      native.__finishImagePaste("failed", null);
      native.__finishImagePaste("failed", image);
      native.__beginImagePaste("expired");
      vi.advanceTimersByTime(30000);
      native.__finishImagePaste("expired", image);
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
