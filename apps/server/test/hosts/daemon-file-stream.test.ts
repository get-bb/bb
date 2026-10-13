import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { HOST_FILE_CHUNK_MAX_BYTES } from "@bb/host-daemon-contract";
import { createDaemonFileStreamResponse } from "../../src/services/hosts/daemon-file-stream.js";

const metadata = {
  path: "/tmp/clip.mp4",
  content: "",
  offset: 0,
  mimeType: "video/mp4",
  sizeBytes: 6,
  modifiedAtMs: 1234,
  revision: "a".repeat(64),
};
const bytes = Buffer.from([0, 1, 2, 3, 4, 5]);
const entityTag = `W/"file-${metadata.revision}"`;
function reader() {
  return vi.fn(
    async (offset: number, length: number, revision: string | null) => {
      expect(revision).toBe(metadata.revision);
      return {
        ...metadata,
        offset,
        content: bytes.subarray(offset, offset + length).toString("base64"),
      };
    },
  );
}
function request(headers: HeadersInit = {}, method = "GET") {
  return new Request("http://bb.test/clip.mp4", { headers, method });
}

describe("daemon file streaming", () => {
  it.each([
    ["bytes=0-1", 0, 1],
    ["bytes=2-", 2, 5],
    ["bytes=-2", 4, 5],
    ["bytes=-999999999999999999999999999", 0, 5],
    ["bytes=1-999999999999999999999999999", 1, 5],
    ["BYTES=0-0", 0, 0],
  ])("reads only the selected bytes for %s", async (range, start, end) => {
    const read = reader();
    const response = await createDaemonFileStreamResponse(
      metadata,
      read,
      request({ range }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${start}-${end}/6`,
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(
      String(end - start + 1),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(start, end + 1),
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(
      start,
      end - start + 1,
      metadata.revision,
    );
  });

  it.each(["bytes=6-", "bytes=-0", "bytes=999999999999999999999999999-"])(
    "rejects %s without reading content",
    async (range) => {
      const read = reader();
      const response = await createDaemonFileStreamResponse(
        metadata,
        read,
        request({ range }),
      );
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */6");
      expect(await response.text()).toBe("");
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    "bytes=0-1,4-5",
    "items=0-1",
    "bytes=wat",
    "bytes=-",
    "bytes=3-1",
    "bytes=1.5-2",
  ])("streams the full response for %s", async (range) => {
    const response = await createDaemonFileStreamResponse(
      metadata,
      reader(),
      request({ range }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("content-range")).toBe(false);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    entityTag,
    '"stale"',
    '"' + metadata.revision + '"',
    "Fri, 02 Jan 2026 03:04:05 GMT",
    "",
  ])(
    "does not use weak metadata validators for If-Range: %s",
    async (ifRange) => {
      const response = await createDaemonFileStreamResponse(
        metadata,
        reader(),
        request({ range: "bytes=0-1", "if-range": ifRange }),
      );
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    },
  );

  it.each([entityTag, "*", '"other", ' + entityTag])(
    "revalidates %s before evaluating Range without reading content",
    async (tag) => {
      const read = reader();
      const response = await createDaemonFileStreamResponse(
        metadata,
        read,
        request({ "if-none-match": tag, range: "bytes=999-" }),
      );
      expect(response.status).toBe(304);
      expect(response.headers.get("etag")).toBe(entityTag);
      expect(response.headers.has("content-range")).toBe(false);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("answers HEAD without reading bytes or applying Range", async () => {
    const read = reader();
    const response = await createDaemonFileStreamResponse(
      metadata,
      read,
      request({ range: "bytes=0-1" }, "HEAD"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("6");
    expect(await response.text()).toBe("");
    expect(read).not.toHaveBeenCalled();
  });

  it("handles empty files and unsatisfiable empty ranges without reading bytes", async () => {
    const read = reader();
    const empty = { ...metadata, sizeBytes: 0 };
    expect(
      (await createDaemonFileStreamResponse(empty, read, request())).status,
    ).toBe(200);
    const response = await createDaemonFileStreamResponse(
      empty,
      read,
      request({ range: "bytes=0-" }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
    expect(read).not.toHaveBeenCalled();
  });

  it("streams a file beyond the old cap one bounded chunk per pull and stops on cancellation", async () => {
    const large = { ...metadata, sizeBytes: 40 * 1024 * 1024 };
    const read = vi.fn(async (offset: number, length: number) => ({
      ...large,
      offset,
      content: Buffer.alloc(length, offset === 0 ? 1 : 2).toString("base64"),
    }));
    const response = await createDaemonFileStreamResponse(
      large,
      read,
      request(),
    );
    expect(response.headers.get("content-length")).toBe(
      String(large.sizeBytes),
    );
    expect(read).toHaveBeenCalledTimes(1);
    const stream = response.body!.getReader();
    expect(
      Buffer.from((await stream.read()).value!).equals(
        Buffer.alloc(HOST_FILE_CHUNK_MAX_BYTES, 1),
      ),
    ).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(
      Buffer.from((await stream.read()).value!).equals(
        Buffer.alloc(HOST_FILE_CHUNK_MAX_BYTES, 2),
      ),
    ).toBe(true);
    expect(read).toHaveBeenLastCalledWith(
      HOST_FILE_CHUNK_MAX_BYTES,
      HOST_FILE_CHUNK_MAX_BYTES,
      metadata.revision,
    );
    await stream.cancel();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("finishes with a short final chunk", async () => {
    const large = { ...metadata, sizeBytes: HOST_FILE_CHUNK_MAX_BYTES + 3 };
    const read = vi.fn(async (offset: number, length: number) => ({
      ...large,
      offset,
      content: Buffer.alloc(length, 1).toString("base64"),
    }));
    const response = await createDaemonFileStreamResponse(
      large,
      read,
      request(),
    );
    expect((await response.arrayBuffer()).byteLength).toBe(large.sizeBytes);
    expect(read).toHaveBeenLastCalledWith(
      HOST_FILE_CHUNK_MAX_BYTES,
      3,
      metadata.revision,
    );
  });

  it.each(["revision", "offset", "size", "short"])(
    "rejects a mismatched %s chunk",
    async (kind) => {
      const read = reader();
      const wrong = { ...metadata, content: bytes.toString("base64") };
      if (kind === "revision") wrong.revision = "b".repeat(64);
      if (kind === "offset") wrong.offset = 1;
      if (kind === "size") wrong.sizeBytes = 7;
      if (kind === "short") wrong.content = "AA==";
      read.mockResolvedValueOnce(wrong);
      await expect(
        createDaemonFileStreamResponse(metadata, read, request()),
      ).rejects.toThrow("File changed");
    },
  );

  it("terminates a started stream if a subsequent chunk fails", async () => {
    const large = { ...metadata, sizeBytes: HOST_FILE_CHUNK_MAX_BYTES + 1 };
    const read = vi.fn(async () => ({
      ...large,
      content: Buffer.alloc(HOST_FILE_CHUNK_MAX_BYTES).toString("base64"),
    }));
    const response = await createDaemonFileStreamResponse(
      large,
      read,
      request(),
    );
    read.mockRejectedValueOnce(new Error("file_changed"));
    await expect(response.arrayBuffer()).rejects.toThrow("file_changed");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops requesting chunks when the HTTP request is aborted", async () => {
    const large = { ...metadata, sizeBytes: HOST_FILE_CHUNK_MAX_BYTES + 1 };
    const read = vi.fn(async () => ({
      ...large,
      content: Buffer.alloc(HOST_FILE_CHUNK_MAX_BYTES).toString("base64"),
    }));
    const abort = new AbortController();
    const response = await createDaemonFileStreamResponse(
      large,
      read,
      new Request("http://bb.test", { signal: abort.signal }),
    );
    const stream = response.body!.getReader();
    await stream.read();
    abort.abort();
    await expect(stream.read()).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
