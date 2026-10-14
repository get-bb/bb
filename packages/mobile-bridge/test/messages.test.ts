import { describe, expect, it } from "vitest";
import {
  SAVE_FILE_SUPPORT,
  base64DecodedLength,
  parsePageToShellMessage,
  parseNativeShellHandshake,
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

function request(kind: string, payload: unknown) {
  return parsePageToShellMessage(
    json({ type: "request", id: "r1-1", request: { kind, payload } }),
  );
}

describe("file save messages", () => {
  it("accepts a transfer, its chunks, and both save sources", () => {
    expect(request("file-transfer-start", { size: 0 }).ok).toBe(true);
    expect(
      request("file-transfer-start", {
        size: SAVE_FILE_SUPPORT.maxTransferBytes,
      }).ok,
    ).toBe(true);
    expect(
      request("file-transfer-chunk", {
        transferId: "t1_abc",
        offset: 0,
        data: "aGVsbG8=",
      }).ok,
    ).toBe(true);
    expect(
      request("save-file", {
        fileName: "notes.zip",
        source: { kind: "transfer", transferId: "t1_abc" },
      }).ok,
    ).toBe(true);
    expect(
      request("save-file", {
        fileName: "notes.zip",
        source: { kind: "url", url: "https://bee.getbb.app/api/v1/x" },
      }).ok,
    ).toBe(true);
  });

  it("refuses a transfer larger than the shell accepts", () => {
    expect(
      request("file-transfer-start", {
        size: SAVE_FILE_SUPPORT.maxTransferBytes + 1,
      }).ok,
    ).toBe(false);
    expect(request("file-transfer-start", { size: -1 }).ok).toBe(false);
  });

  it("refuses a chunk over the chunk limit or that is not base64", () => {
    const fullChunk = "A".repeat(
      Math.ceil(SAVE_FILE_SUPPORT.chunkBytes / 3) * 4,
    );
    const chunk = (data: string) =>
      request("file-transfer-chunk", { transferId: "t1", offset: 0, data });
    expect(chunk(fullChunk).ok).toBe(true);
    expect(chunk(`${fullChunk}AAAA`).ok).toBe(false);
    expect(chunk("not base64!").ok).toBe(false);
    expect(chunk("abc").ok).toBe(false);
    expect(chunk("").ok).toBe(false);
  });

  it("only saves from http or https urls", () => {
    for (const url of [
      "file:///etc/passwd",
      "blob:https://bee.getbb.app/1",
      "javascript:alert(1)",
    ]) {
      expect(
        request("save-file", { fileName: "x", source: { kind: "url", url } })
          .ok,
      ).toBe(false);
    }
  });

  it("refuses an empty file name and a transfer id that is not a token", () => {
    expect(
      request("save-file", {
        fileName: "  ",
        source: { kind: "transfer", transferId: "t1" },
      }).ok,
    ).toBe(false);
    expect(
      request("save-file", {
        fileName: "x",
        source: { kind: "transfer", transferId: "../t1" },
      }).ok,
    ).toBe(false);
  });

  it("counts the bytes a base64 chunk carries", () => {
    expect(base64DecodedLength("aGVsbG8=")).toBe(5);
    expect(base64DecodedLength("aGVsbA==")).toBe(4);
    expect(base64DecodedLength("aGVs")).toBe(3);
  });
});

describe("save-file handshake support", () => {
  it("carries the shell's limits next to the capabilities", () => {
    const withSave = { ...handshake, saveFile: SAVE_FILE_SUPPORT };
    expect(parseNativeShellHandshake(withSave)).toEqual(withSave);
    expect(
      parseNativeShellHandshake({
        ...handshake,
        saveFile: { maxTransferBytes: 0, chunkBytes: 1 },
      }),
    ).toBeNull();
  });

  it("stays out of the capability list an older page validates strictly", () => {
    expect(
      parseNativeShellHandshake({
        ...handshake,
        capabilities: [...handshake.capabilities, "save-file"],
      }),
    ).toBeNull();
  });
});
