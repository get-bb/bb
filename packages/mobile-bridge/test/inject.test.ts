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
      "fetch",
      script,
    )(
      fakeWindow,
      page.document,
      page.DataTransfer,
      page.ClipboardEvent,
      page.fetch,
    );
  };
  run(buildBridgeInjectionScript({ ...handshake, ...overrides }));
  const native = fakeWindow.bb?.native;
  if (native === undefined) throw new Error("bridge did not install");
  return { native, posted, run, fakeWindow };
}

describe("buildBridgeInjectionScript", () => {
  it("sends Android text and image copy through the existing request/reply bridge", async () => {
    const { native, posted, run } = installBridge({ platform: "android" });
    const promise = native.copyTextAndImage?.(
      "A photo",
      "https://test/photo.png",
    );
    const parsed = parsePageToShellMessage(posted[0]);
    if (!parsed.ok || parsed.message.type !== "request")
      throw new Error("Invalid clipboard request");
    expect(parsed.message.request).toEqual({
      kind: "clipboard",
      payload: { text: "A photo", imageUrl: "https://test/photo.png" },
    });
    run(
      buildBridgeEventScript({
        type: "response",
        id: parsed.message.id,
        response: { ok: true, result: { copied: true } },
      }),
    );
    await expect(promise).resolves.toEqual({ copied: true });
    expect(native.capabilities).toEqual(handshake.capabilities);
    expect(
      installBridge({ platform: "ios" }).native.copyTextAndImage,
    ).toBeUndefined();
  });
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

  it("allows image copies longer than the default request timeout", async () => {
    vi.useFakeTimers();
    try {
      const { native } = installBridge();
      const promise = native.request("clipboard", {
        text: "hello",
        imageUrl: "https://example.com/image.png",
      });
      const rejected = vi.fn();
      void promise.catch(rejected);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(rejected).not.toHaveBeenCalled();
      const assertion = expect(promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(20_000);
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
  __beginImagePaste(id: string, url: string): boolean;
  __finishImagePaste(
    id: string,
    image: { name: string; type: string } | null,
  ): void;
}

const image = { name: "screenshot.png", type: "image/png" };
const imageBytes = new Uint8Array([0, 1, 2, 3, 255]);
const imageUrl = "https://test/__bb_keyboard_image/image";

function installImageBridge(
  fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => new Response(imageBytes)),
) {
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
    { document, DataTransfer: Transfer, ClipboardEvent: Paste, fetch },
  );
  return {
    native: native as ImagePasteApi,
    document,
    target,
    dispatchEvent,
    fakeWindow,
    fetch,
  };
}

function pendingImageResponse() {
  let finish!: () => void;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(imageBytes);
          controller.close();
        };
      },
    }),
  );
  const blob = vi.spyOn(response, "blob");
  return { response, finish, blob };
}

describe("native keyboard image paste", () => {
  it.each(["before", "after"])(
    "delivers bytes and metadata to the original editor when native completion arrives %s the body",
    async (order) => {
      const body = pendingImageResponse();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(body.response);
      const { native, document, dispatchEvent } = installImageBridge(fetch);
      expect(native.__beginImagePaste("image", imageUrl)).toBe(true);
      document.activeElement = {
        ...document.activeElement,
        dispatchEvent: vi.fn(),
      };
      if (order === "before") native.__finishImagePaste("image", image);
      body.finish();
      await vi.waitFor(() => expect(body.blob).toHaveBeenCalled());
      await body.blob.mock.results[0]?.value;
      if (order === "after") {
        expect(dispatchEvent).not.toHaveBeenCalled();
        native.__finishImagePaste("image", image);
      }
      await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledTimes(1));
      const event = dispatchEvent.mock.calls[0]?.[0];
      expect(event.type).toBe("paste");
      const file: File = event.options.clipboardData.files[0];
      expect(file.name).toBe("screenshot.png");
      expect(file.type).toBe("image/png");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(imageBytes);
      expect(fetch).toHaveBeenCalledWith(imageUrl, {
        signal: expect.any(AbortSignal),
        credentials: "omit",
        cache: "no-store",
      });
      native.__finishImagePaste("image", image);
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects editors outside the composer without reading the image", () => {
    const { native, target, fetch } = installImageBridge();
    target.closest.mockReturnValueOnce(null);
    expect(native.__beginImagePaste("outside", imageUrl)).toBe(false);
    target.isContentEditable = false;
    expect(native.__beginImagePaste("text", imageUrl)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["removed", "navigation"])(
    "discards a pending body after %s",
    async (change) => {
      const body = pendingImageResponse();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(body.response);
      const { native, target, fakeWindow, dispatchEvent } =
        installImageBridge(fetch);
      native.__beginImagePaste("image", imageUrl);
      native.__finishImagePaste("image", image);
      if (change === "removed") target.isConnected = false;
      else fakeWindow.location.href = "https://test/threads/two";
      body.finish();
      await vi.waitFor(() =>
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true),
      );
      expect(dispatchEvent).not.toHaveBeenCalled();
    },
  );

  it.each(["native", "http", "read", "empty", "oversized"])(
    "discards a %s failure and allows the next image",
    async (failure) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      if (failure === "read")
        fetch.mockRejectedValueOnce(new Error("Stream failed"));
      else if (failure === "http")
        fetch.mockResolvedValueOnce(new Response(null, { status: 410 }));
      else if (failure === "empty")
        fetch.mockResolvedValueOnce(new Response(new Blob([])));
      else if (failure === "oversized") {
        fetch.mockResolvedValueOnce(
          new Response(new Blob([new Uint8Array(35 * 1024 * 1024 + 1)])),
        );
      } else fetch.mockResolvedValueOnce(new Response(imageBytes));
      fetch.mockResolvedValueOnce(new Response(imageBytes));
      const { native, dispatchEvent } = installImageBridge(fetch);
      native.__beginImagePaste("failed", imageUrl);
      native.__finishImagePaste("failed", failure === "native" ? null : image);
      await vi.waitFor(() =>
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true),
      );
      expect(dispatchEvent).not.toHaveBeenCalled();
      native.__beginImagePaste("next", imageUrl);
      native.__finishImagePaste("next", image);
      await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledTimes(1));
    },
  );

  it("aborts an expired body and ignores its late completion", async () => {
    vi.useFakeTimers();
    try {
      const body = pendingImageResponse();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(body.response);
      const { native, dispatchEvent } = installImageBridge(fetch);
      native.__beginImagePaste("expired", imageUrl);
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      native.__finishImagePaste("expired", image);
      body.finish();
      await vi.waitFor(() => expect(body.blob).toHaveBeenCalled());
      await body.blob.mock.results[0]?.value;
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
