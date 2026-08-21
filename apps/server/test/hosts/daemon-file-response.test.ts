import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  createDaemonFileContentResponse,
  requestMatchesEntityTag,
  type DaemonFileReadResult,
} from "../../src/services/hosts/daemon-file-response.js";

const IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const IMAGE_RESULT: DaemonFileReadResult = {
  path: "/tmp/screenshot.png",
  content: IMAGE_BYTES.toString("base64"),
  contentEncoding: "base64",
  mimeType: "image/png",
  sizeBytes: IMAGE_BYTES.byteLength,
  modifiedAtMs: Date.UTC(2026, 0, 2, 3, 4, 5),
  sha256: "abc123",
};

describe("createDaemonFileContentResponse", () => {
  it("adds validators and a revalidate-only cache policy to host file bytes", async () => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("last-modified")).toBe(
      "Fri, 02 Jan 2026 03:04:05 GMT",
    );
    expect(response.headers.get("content-length")).toBe(
      String(IMAGE_BYTES.byteLength),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
  });

  it("keeps caller-provided cache-control and content-type", () => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      headers: { "cache-control": "no-store", "content-type": "text/html" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("etag")).toBe('"abc123"');
  });

  it("answers 304 without a body when If-None-Match carries the current tag", async () => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      ifNoneMatch: 'W/"other", "abc123"',
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.has("content-length")).toBe(false);
    expect((await response.arrayBuffer()).byteLength).toBe(0);

    const changed = createDaemonFileContentResponse(IMAGE_RESULT, {
      ifNoneMatch: '"stale"',
    });
    expect(changed.status).toBe(200);
  });

  it("omits Last-Modified when the daemon has no mtime", () => {
    const response = createDaemonFileContentResponse({
      path: IMAGE_RESULT.path,
      content: IMAGE_RESULT.content,
      contentEncoding: IMAGE_RESULT.contentEncoding,
      mimeType: IMAGE_RESULT.mimeType,
      sizeBytes: IMAGE_RESULT.sizeBytes,
      sha256: IMAGE_RESULT.sha256,
    });
    expect(response.headers.has("last-modified")).toBe(false);
  });
});

describe("requestMatchesEntityTag", () => {
  it("matches wildcard, exact, and weak-prefixed tags", () => {
    expect(requestMatchesEntityTag(undefined, '"a"')).toBe(false);
    expect(requestMatchesEntityTag("*", '"a"')).toBe(true);
    expect(requestMatchesEntityTag('"a"', '"a"')).toBe(true);
    expect(requestMatchesEntityTag('W/"a"', '"a"')).toBe(true);
    expect(requestMatchesEntityTag('"b", "c"', '"a"')).toBe(false);
  });
});
