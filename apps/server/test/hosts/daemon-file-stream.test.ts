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
});
