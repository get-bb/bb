import { describe, expect, it } from "vitest";
import {
  parsePageToShellMessage,
  parseNativeShellHandshake,
  sharedContentResponseSchema,
  sharedUploadStatusSchema,
  type NativeShellHandshake,
} from "../src/index.js";

function json(value: unknown): string {
  return JSON.stringify(value);
}

const handshake: NativeShellHandshake = {
  bridgeVersion: 3,
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
      { type: "ready", path: "/?shareId=share_1", pageBridgeVersion: 3 },
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

  it("accepts older ready messages and validates optional page versions", () => {
    expect(
      parsePageToShellMessage(json({ type: "ready", path: "/" })),
    ).toMatchObject({ ok: true });
    expect(
      parsePageToShellMessage(
        json({ type: "ready", path: "/", pageBridgeVersion: 3 }),
      ),
    ).toMatchObject({ ok: true });
    for (const pageBridgeVersion of [0, -1, 1.5, "3"]) {
      expect(
        parsePageToShellMessage(
          json({ type: "ready", path: "/", pageBridgeVersion }),
        ).ok,
      ).toBe(false);
    }
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

  it("accepts scoped share requests and rejects local file locations at the web boundary", () => {
    const shareId = "43d79879-0dd3-43b6-a76b-426cdcd94787";
    const fileId = "d81f350a-9792-47ab-b944-12802eddb553";
    const requests = [
      { kind: "get-shared-content", payload: { shareId, projectId: "proj_1" } },
      {
        kind: "start-shared-upload",
        payload: { shareId, fileId, projectId: "proj_1" },
      },
      { kind: "shared-upload-status", payload: { jobId: "job-1" } },
      { kind: "acknowledge-share", payload: { shareId, projectId: "proj_1" } },
    ];
    for (const request of requests) {
      expect(
        parsePageToShellMessage(json({ type: "request", id: "r1", request }))
          .ok,
      ).toBe(true);
    }
    expect(
      parsePageToShellMessage(
        json({
          type: "request",
          id: "r2",
          request: {
            kind: "get-shared-content",
            payload: {
              shareId,
              projectId: "proj_1",
              uri: "file:///private/item",
            },
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("validates public share metadata and upload results without accepting device URIs", () => {
    const content = {
      claimScopeKey: "43d79879-0dd3-43b6-a76b-426cdcd94787",
      shareId: "d81f350a-9792-47ab-b944-12802eddb553",
      text: "Look at this",
      files: [
        {
          fileId: "e3d835be-51a7-4a6c-b33b-c36b67a9eb9e",
          fileName: "image.png",
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 120,
        },
      ],
    };
    expect(sharedContentResponseSchema.parse(content)).toEqual(content);
    expect(
      sharedContentResponseSchema.safeParse({
        ...content,
        files: [{ ...content.files[0], uri: "file:///private/image.png" }],
      }).success,
    ).toBe(false);
    expect(
      sharedUploadStatusSchema.parse({
        jobId: "job-1",
        status: "complete",
        attachment: {
          type: "localImage",
          path: "image.png",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 120,
          sourceProjectId: "proj_1",
        },
      }).status,
    ).toBe("complete");
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
