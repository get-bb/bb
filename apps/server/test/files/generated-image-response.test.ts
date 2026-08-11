import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { createGeneratedImageContentResponse } from "../../src/services/hosts/daemon-file-response.js";

function fileResult(args: {
  bytes: Uint8Array;
  mimeType?: string;
  sizeBytes?: number;
}) {
  return {
    path: "/tmp/generated-image",
    content: Buffer.from(args.bytes).toString("base64"),
    contentEncoding: "base64" as const,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes ?? args.bytes.byteLength,
    sha256: "0".repeat(64),
  };
}

function expectApiError(fn: () => unknown, status: number, code: string) {
  try {
    fn();
    throw new Error("Expected an ApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, body: { code } });
  }
}

describe("generated image content response", () => {
  it.each([
    ["JPEG", "image/jpeg", [0xff, 0xd8, 0xff]],
    ["GIF", "image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    [
      "WebP",
      "image/webp",
      [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
    ],
  ])(
    "accepts %s content with a matching signature",
    async (_, mimeType, signature) => {
      const bytes = Uint8Array.from(signature);
      const response = createGeneratedImageContentResponse(
        fileResult({ bytes, mimeType }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(mimeType);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    },
  );

  it("accepts raster content only when its MIME type and signature agree", async () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const response = createGeneratedImageContentResponse(
      fileResult({ bytes: png, mimeType: "image/png" }),
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);

    expectApiError(
      () =>
        createGeneratedImageContentResponse(
          fileResult({ bytes: png, mimeType: "image/jpeg" }),
        ),
      415,
      "unsupported_media_type",
    );
    expectApiError(
      () =>
        createGeneratedImageContentResponse(
          fileResult({
            bytes: new TextEncoder().encode("<svg></svg>"),
            mimeType: "image/svg+xml",
          }),
        ),
      415,
      "unsupported_media_type",
    );
    expectApiError(
      () =>
        createGeneratedImageContentResponse(
          fileResult({
            bytes: new TextEncoder().encode("<html></html>"),
            mimeType: "text/html",
          }),
        ),
      415,
      "unsupported_media_type",
    );
    expectApiError(
      () => createGeneratedImageContentResponse(fileResult({ bytes: png })),
      415,
      "unsupported_media_type",
    );
  });

  it("rejects inconsistent and oversized responses", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expectApiError(
      () =>
        createGeneratedImageContentResponse(
          fileResult({
            bytes: png,
            mimeType: "image/png",
            sizeBytes: png.byteLength + 1,
          }),
        ),
      422,
      "invalid_image",
    );
    expectApiError(
      () =>
        createGeneratedImageContentResponse(
          fileResult({
            bytes: png,
            mimeType: "image/png",
            sizeBytes: 10 * 1024 * 1024 + 1,
          }),
        ),
      413,
      "file_too_large",
    );
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(png);
    expectApiError(
      () =>
        createGeneratedImageContentResponse(
          fileResult({ bytes: oversized, mimeType: "image/png", sizeBytes: 1 }),
        ),
      413,
      "file_too_large",
    );
  });
});
