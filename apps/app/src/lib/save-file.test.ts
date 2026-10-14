// @vitest-environment jsdom

import {
  SAVE_FILE_SUPPORT,
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  parsePageToShellMessage,
  type BridgeResponse,
  type NativeShellHandshake,
  type PageToShellMessage,
} from "@bb/mobile-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNativeShellForTests } from "@/lib/native-shell/native-shell";
import { resolveNativeSaveSource, saveFile } from "./save-file";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: toastMocks,
}));

const handshake: NativeShellHandshake = {
  bridgeVersion: 2,
  appVersion: "0.39.0",
  platform: "ios",
  profileMode: "direct",
  secureContext: true,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  capabilities: ["haptic", "badge", "share", "open-external", "safe-area"],
  saveFile: SAVE_FILE_SUPPORT,
};

type RequestMessage = Extract<PageToShellMessage, { type: "request" }>;

const requests: RequestMessage["request"][] = [];
let respond: (request: RequestMessage["request"]) => BridgeResponse;

function installShell(overrides: Partial<NativeShellHandshake> = {}): void {
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: {
      postMessage: (raw: string) => {
        const parsed = parsePageToShellMessage(raw);
        if (!parsed.ok) throw new Error(`shell rejected: ${parsed.reason}`);
        const { message } = parsed;
        if (message.type !== "request") return;
        requests.push(message.request);
        const response = respond(message.request);
        queueMicrotask(() => {
          // eslint-disable-next-line no-new-func
          new Function(
            "window",
            buildBridgeEventScript({
              type: "response",
              id: message.id,
              response,
            }),
          )(window);
        });
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

function removeShell(): void {
  Reflect.deleteProperty(window, "bb");
  Reflect.deleteProperty(window, "ReactNativeWebView");
  resetNativeShellForTests();
}

function decode(base64: string): string {
  return atob(base64);
}

const anchorClicks: { href: string; download: string }[] = [];

beforeEach(() => {
  requests.length = 0;
  anchorClicks.length = 0;
  toastMocks.error.mockReset();
  respond = () => ({ ok: true, result: { outcome: "saved" } });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      anchorClicks.push({ href: this.href, download: this.download });
    },
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:http://localhost:3000/object",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  removeShell();
});

describe("saveFile outside the iOS app", () => {
  it("downloads with an ordinary link and never talks to a bridge", async () => {
    removeShell();
    await expect(
      saveFile({ url: "/api/v1/files/notes.zip", fileName: "notes.zip" }),
    ).resolves.toBe("started");
    expect(anchorClicks).toEqual([
      {
        href: `${window.location.origin}/api/v1/files/notes.zip`,
        download: "notes.zip",
      },
    ]);
  });

  it("keeps today's behavior in an older shell without file saving", async () => {
    installShell({ saveFile: undefined });
    await expect(
      saveFile({ blob: new Blob(["hi"]), fileName: "voice.webm" }),
    ).resolves.toBe("started");
    expect(requests).toEqual([]);
    expect(anchorClicks).toHaveLength(1);
  });
});

describe("saveFile in the iOS app", () => {
  it("asks the shell to fetch a server file with the app's cookies", async () => {
    installShell();
    await expect(
      saveFile({ url: "/api/v1/files/notes.zip", fileName: "notes.zip" }),
    ).resolves.toBe("saved");
    expect(requests).toEqual([
      {
        kind: "save-file",
        payload: {
          fileName: "notes.zip",
          source: {
            kind: "url",
            url: `${window.location.origin}/api/v1/files/notes.zip`,
          },
        },
      },
    ]);
    expect(anchorClicks).toEqual([]);
  });

  it("sends page bytes in ordered chunks the shell can reassemble", async () => {
    installShell({ saveFile: { maxTransferBytes: 1024, chunkBytes: 4 } });
    respond = (request) => {
      if (request.kind === "file-transfer-start") {
        return { ok: true, result: { transferId: "t1_x" } };
      }
      if (request.kind === "file-transfer-chunk") {
        return {
          ok: true,
          result: {
            received:
              request.payload.offset + decode(request.payload.data).length,
          },
        };
      }
      return { ok: true, result: { outcome: "dismissed" } };
    };
    await expect(
      saveFile({ blob: new Blob(["hello world"]), fileName: "note.txt" }),
    ).resolves.toBe("dismissed");
    expect(requests[0]).toEqual({
      kind: "file-transfer-start",
      payload: { size: 11 },
    });
    const chunks = requests.flatMap((request) =>
      request.kind === "file-transfer-chunk" ? [request.payload] : [],
    );
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 4, 8]);
    expect(chunks.map((chunk) => decode(chunk.data)).join("")).toBe(
      "hello world",
    );
    expect(requests.at(-1)).toEqual({
      kind: "save-file",
      payload: {
        fileName: "note.txt",
        source: { kind: "transfer", transferId: "t1_x" },
      },
    });
  });

  it("refuses a blob over the shell's limit before sending any of it", async () => {
    installShell({ saveFile: { maxTransferBytes: 4, chunkBytes: 4 } });
    await expect(
      saveFile({ blob: new Blob(["too big"]), fileName: "big.bin" }),
    ).resolves.toBe("failed");
    expect(requests).toEqual([]);
    expect(toastMocks.error).toHaveBeenCalledWith("Couldn't save big.bin", {
      description: "This file is too large to save on this device",
    });
  });

  it("reports a shell failure instead of failing silently", async () => {
    installShell();
    respond = () => ({ ok: false, error: "response has status 401" });
    await expect(
      saveFile({ url: "/api/v1/files/notes.zip", fileName: "notes.zip" }),
    ).resolves.toBe("failed");
    expect(toastMocks.error).toHaveBeenCalledWith("Couldn't save notes.zip", {
      description: "response has status 401",
    });
  });

  it("does not trust a malformed reply from the shell", async () => {
    installShell();
    respond = () => ({ ok: true, result: { outcome: "maybe" } });
    await expect(
      saveFile({ url: "/api/v1/files/notes.zip", fileName: "notes.zip" }),
    ).resolves.toBe("failed");
  });
});

describe("resolveNativeSaveSource", () => {
  const page = "https://bee.getbb.app/threads/thr_1";

  it("lets the shell fetch only urls on the page's own origin", () => {
    expect(
      resolveNativeSaveSource({ url: "/api/v1/x", fileName: "x" }, page),
    ).toEqual({ kind: "server-url", url: "https://bee.getbb.app/api/v1/x" });
    expect(
      resolveNativeSaveSource(
        { url: "https://other.example/x", fileName: "x" },
        page,
      ),
    ).toEqual({ kind: "anchor" });
  });

  it("reads page-local urls in the page, because the shell cannot", () => {
    expect(
      resolveNativeSaveSource(
        { url: "blob:https://bee.getbb.app/1", fileName: "x" },
        page,
      ),
    ).toEqual({ kind: "page-url", url: "blob:https://bee.getbb.app/1" });
  });
});
