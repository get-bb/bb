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

  it.each([
    ["bytes=0-1", 0, 1],
    ["bytes=2-", 2, 5],
    ["bytes=-2", 4, 5],
    ["bytes=-999999999999999999999999999", 0, 5],
    ["bytes=1-999999999999999999999999999", 1, 5],
    ["BYTES=0-0", 0, 0],
  ])("serves the requested bytes for %s", async (range, start, end) => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      rangeRequest: new Request("http://bb.test/file", { headers: { range } }),
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${start}-${end}/6`,
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(
      String(end - start + 1),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      IMAGE_BYTES.subarray(start, end + 1),
    );
  });

  it.each(["bytes=6-", "bytes=-0", "bytes=999999999999999999999999999-"])(
    "rejects an unsatisfiable range %s",
    async (range) => {
      const response = createDaemonFileContentResponse(IMAGE_RESULT, {
        rangeRequest: new Request("http://bb.test/file", {
          headers: { range },
        }),
      });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */6");
      expect(response.headers.get("content-length")).toBe("0");
      expect(await response.text()).toBe("");
    },
  );

  it.each([
    "bytes=0-1,4-5",
    "items=0-1",
    "bytes=wat",
    "bytes=-",
    "bytes=3-1",
    "bytes=1.5-2",
  ])("ignores unsupported or malformed ranges: %s", async (range) => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      rangeRequest: new Request("http://bb.test/file", { headers: { range } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.has("content-range")).toBe(false);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
  });

  it.each([
    ['"abc123"', 206],
    ['"stale"', 200],
    ['W/"abc123"', 200],
    ["Fri, 02 Jan 2026 03:04:05 GMT", 200],
    ["", 200],
  ])("checks the strong If-Range validator %s", (ifRange, status) => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      rangeRequest: new Request("http://bb.test/file", {
        headers: { range: "bytes=0-1", "if-range": ifRange },
      }),
    });
    expect(response.status).toBe(status);
  });

  it("revalidates before evaluating an unsatisfiable range", () => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      ifNoneMatch: 'W/"abc123"',
      rangeRequest: new Request("http://bb.test/file", {
        headers: { range: "bytes=999-" },
      }),
    });
    expect(response.status).toBe(304);
    expect(response.headers.has("content-range")).toBe(false);
  });

  it("ignores Range on HEAD", () => {
    const response = createDaemonFileContentResponse(IMAGE_RESULT, {
      rangeRequest: new Request("http://bb.test/file", {
        method: "HEAD",
        headers: { range: "bytes=0-1" },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("6");
    expect(response.headers.has("content-range")).toBe(false);
  });

  it("rejects ranges of an empty file", () => {
    const response = createDaemonFileContentResponse(
      { ...IMAGE_RESULT, content: "", sizeBytes: 0 },
      {
        rangeRequest: new Request("http://bb.test/file", {
          headers: { range: "bytes=0-" },
        }),
      },
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
  });

  it("ranges UTF-8 content by bytes", async () => {
    const response = createDaemonFileContentResponse(
      { ...IMAGE_RESULT, content: "é!", contentEncoding: "utf8", sizeBytes: 3 },
      {
        rangeRequest: new Request("http://bb.test/file", {
          headers: { range: "bytes=1-2" },
        }),
      },
    );
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([0xa9, 0x21]),
    );
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

  it("answers 304 when the daemon omitted unchanged content", async () => {
    const response = createDaemonFileContentResponse({
      path: IMAGE_RESULT.path,
      contentEncoding: IMAGE_RESULT.contentEncoding,
      mimeType: IMAGE_RESULT.mimeType,
      sizeBytes: IMAGE_RESULT.sizeBytes,
      sha256: IMAGE_RESULT.sha256,
      notModified: true,
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
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
