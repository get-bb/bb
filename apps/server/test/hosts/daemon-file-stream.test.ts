import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { HOST_FILE_CHUNK_MAX_BYTES } from "@bb/host-daemon-contract";
import { createDaemonFileStreamResponse } from "../../src/services/hosts/daemon-file-stream.js";

const metadata = {
  path: "/tmp/clip.mp4",
  content: new Uint8Array(),
  offset: 0,
  mimeType: "video/mp4",
  sizeBytes: 6,
  modifiedAtMs: 1234,
  revision: "a".repeat(64),
};
const bytes = Buffer.from([0, 1, 2, 3, 4, 5]);
function reader() {
  return vi.fn(
    async (
      offset: number,
      length: number,
      revision: string | null,
      _signal: AbortSignal,
    ) => {
      expect(revision).toBe(metadata.revision);
      return {
        ...metadata,
        offset,
        content: new Uint8Array(bytes.subarray(offset, offset + length)),
      };
    },
  );
}
function request(headers: HeadersInit = {}, method = "GET") {
  return new Request("http://bb.test/clip.mp4", { headers, method });
}

describe("daemon file streaming", () => {
  it.each(["revision", "offset", "size", "short"])(
    "rejects a mismatched %s chunk",
    async (kind) => {
      const read = reader();
      const wrong = { ...metadata, content: new Uint8Array(bytes) };
      if (kind === "revision") wrong.revision = "b".repeat(64);
      if (kind === "offset") wrong.offset = 1;
      if (kind === "size") wrong.sizeBytes = 7;
      if (kind === "short") wrong.content = new Uint8Array(1);
      read.mockResolvedValueOnce(wrong);
      await expect(
        createDaemonFileStreamResponse(metadata, read, request()),
      ).rejects.toThrow("File changed");
    },
  );

  it("reads several chunks ahead and still delivers them in order", async () => {
    const chunkCount = 24;
    const large = {
      ...metadata,
      sizeBytes: chunkCount * HOST_FILE_CHUNK_MAX_BYTES,
    };
    const read = vi.fn(async (offset: number, length: number) => {
      const index = offset / HOST_FILE_CHUNK_MAX_BYTES;
      await new Promise((resolve) => setTimeout(resolve, chunkCount - index));
      return { ...large, offset, content: new Uint8Array(length).fill(index) };
    });
    const response = await createDaemonFileStreamResponse(
      large,
      read,
      request(),
    );
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(read.mock.calls.length).toBeLessThan(chunkCount);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(
      Array.from(
        { length: chunkCount },
        (_, index) => body[index * HOST_FILE_CHUNK_MAX_BYTES],
      ),
    ).toEqual(Array.from({ length: chunkCount }, (_, index) => index));
  });

  it("fails the stream and aborts the other in-flight reads when a chunk fails", async () => {
    const large = {
      ...metadata,
      sizeBytes: 4 * HOST_FILE_CHUNK_MAX_BYTES,
    };
    const aborted: number[] = [];
    const read = vi.fn(
      (
        offset: number,
        length: number,
        _revision: string | null,
        signal: AbortSignal,
      ) => {
        if (offset === 0) {
          return Promise.resolve({
            ...large,
            offset,
            content: new Uint8Array(length),
          });
        }
        if (offset === HOST_FILE_CHUNK_MAX_BYTES) {
          return Promise.reject(new Error("file_changed"));
        }
        return new Promise<typeof large>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted.push(offset);
            reject(signal.reason);
          });
        });
      },
    );
    const response = await createDaemonFileStreamResponse(
      large,
      read,
      request(),
    );
    await expect(response.arrayBuffer()).rejects.toThrow("file_changed");
    expect(aborted).toEqual([
      2 * HOST_FILE_CHUNK_MAX_BYTES,
      3 * HOST_FILE_CHUNK_MAX_BYTES,
    ]);
  });
});
