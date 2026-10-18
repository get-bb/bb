import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileStreamResponse,
  type FileResponseSource,
} from "../../src/services/files/file-stream-response.js";
import { createLocalFileSource } from "../../src/services/files/local-file-source.js";
import { createDaemonFileSource } from "../../src/services/hosts/daemon-file-stream.js";

const bytes = Buffer.from("0123456789");

describe.each(["local", "daemon"] as const)(
  "%s file response contract",
  (kind) => {
    let directory: string;
    let source: FileResponseSource;
    const opened: Array<{
      signal: AbortSignal;
      read: ReturnType<
        typeof vi.fn<(offset: number, length: number) => Promise<Uint8Array>>
      >;
      close: ReturnType<typeof vi.fn<() => Promise<void>>>;
    }> = [];

    async function prepare(content: Buffer) {
      if (kind === "local") {
        const path = join(directory, "recording.mp4");
        await writeFile(path, content);
        source = createLocalFileSource(path, await stat(path));
      } else {
        const metadata = {
          path: "/recording.mp4",
          content: "",
          offset: 0,
          mimeType: "video/mp4",
          sizeBytes: content.length,
          modifiedAtMs: 1234,
          revision: "a".repeat(64),
        };
        source = createDaemonFileSource(
          metadata,
          async (offset, length, revision, signal) => {
            signal.throwIfAborted();
            expect(revision).toBe(metadata.revision);
            return {
              ...metadata,
              offset,
              content: content
                .subarray(offset, offset + length)
                .toString("base64"),
            };
          },
        );
      }
      const open = source.open;
      source.open = async (signal) => {
        const reader = await open(signal);
        const observed = {
          signal,
          read: vi.fn(reader.read),
          close: vi.fn(reader.close),
        };
        opened.push(observed);
        return { ...reader, ...observed };
      };
    }

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "bb-file-response-"));
      opened.length = 0;
      await prepare(bytes);
    });
    afterEach(async () => {
      await Promise.all(opened.map((reader) => reader.close()));
      await rm(directory, { recursive: true, force: true });
    });

    function respond(
      headers: HeadersInit = {},
      method = "GET",
      signal?: AbortSignal,
      cacheControl = "private, no-cache",
    ) {
      return createFileStreamResponse({
        source,
        request: new Request("http://bb.test/recording.mp4", {
          headers,
          method,
          signal,
        }),
        headers: new Headers({
          "content-type": "video/mp4",
          "cache-control": cacheControl,
          "content-security-policy": "sandbox allow-scripts",
          "x-content-type-options": "nosniff",
        }),
      });
    }

    it.each([
      ["bytes=0-1", "01", "bytes 0-1/10"],
      ["bytes=4-", "456789", "bytes 4-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      ["bytes=8-100", "89", "bytes 8-9/10"],
      ["bytes=-999999999999999999999999", "0123456789", "bytes 0-9/10"],
      ["bytes=1-999999999999999999999999", "123456789", "bytes 1-9/10"],
      ["BYTES=0-0", "0", "bytes 0-0/10"],
    ])(
      "serves exactly the requested bytes for %s",
      async (range, body, contentRange) => {
        const response = await respond({ range });
        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe(contentRange);
        expect(response.headers.get("content-length")).toBe(
          String(body.length),
        );
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        expect(response.headers.get("content-type")).toBe("video/mp4");
        expect(await response.text()).toBe(body);
        expect(opened[0]!.close).toHaveBeenCalledTimes(1);
      },
    );

    it.each(["bytes=10-", "bytes=-0", "bytes=999999999999999999999999-"])(
      "rejects %s without opening the reader",
      async (range) => {
        const response = await respond({ range });
        expect(response.status).toBe(416);
        expect(response.headers.get("content-range")).toBe("bytes */10");
        expect(await response.text()).toBe("");
        expect(opened).toHaveLength(0);
      },
    );

    it.each([
      "bytes=0-1,4-5",
      "items=0-1",
      "bytes=wat",
      "bytes=-",
      "bytes=3-1",
      "bytes=1.5-2",
    ])("ignores unsupported or malformed range %s", async (range) => {
      const response = await respond({ range });
      expect(response.status).toBe(200);
      expect(response.headers.has("content-range")).toBe(false);
      expect(await response.text()).toBe("0123456789");
    });

    it("revalidates before range evaluation without opening the reader", async () => {
      for (const tag of [
        source.entityTag,
        "*",
        `"other", ${source.entityTag}`,
      ]) {
        const response = await respond({
          "if-none-match": tag,
          range: "bytes=999-",
        });
        expect(response.status).toBe(304);
        expect(response.headers.get("etag")).toBe(source.entityTag);
        expect(response.headers.has("content-range")).toBe(false);
        expect(await response.text()).toBe("");
      }
      expect(opened).toHaveLength(0);
    });

    it("honors strong If-Range validators and falls back for weak or stale validators", async () => {
      for (const validator of [source.entityTag, source.lastModified]) {
        const response = await respond({
          range: "bytes=0-1",
          "if-range": validator,
        });
        expect(response.status).toBe(kind === "local" ? 206 : 200);
        expect(await response.text()).toBe(
          kind === "local" ? "01" : "0123456789",
        );
      }
      for (const validator of [
        '"stale"',
        `W/${source.entityTag}`,
        "Thu, 01 Jan 1970 00:00:00 GMT",
        "",
      ]) {
        const response = await respond({
          range: "bytes=0-1",
          "if-range": validator,
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("0123456789");
      }
    });

    it("preserves explicit route policies on full, partial, cached and rejected responses", async () => {
      for (const headers of [
        new Headers(),
        new Headers({ range: "bytes=0-1" }),
        new Headers({ "if-none-match": "*" }),
        new Headers({ range: "bytes=99-" }),
      ]) {
        const response = await respond(headers);
        expect(response.headers.get("content-security-policy")).toBe(
          "sandbox allow-scripts",
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("cache-control")).toBe("private, no-cache");
        await response.arrayBuffer();
      }
      const noStore = await respond(
        { "if-none-match": source.entityTag },
        "GET",
        undefined,
        "no-store",
      );
      expect(noStore.status).toBe(200);
      expect(noStore.headers.get("cache-control")).toBe("no-store");
      expect(await noStore.text()).toBe("0123456789");
    });

    it("answers HEAD and empty files without opening a reader", async () => {
      const head = await respond({ range: "bytes=0-1" }, "HEAD");
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe("10");
      expect(await head.text()).toBe("");
      await prepare(Buffer.alloc(0));
      const empty = await respond();
      expect(empty.status).toBe(200);
      expect(empty.headers.get("content-length")).toBe("0");
      expect(await empty.text()).toBe("");
      const range = await respond({ range: "bytes=0-" });
      expect(range.status).toBe(416);
      expect(range.headers.get("content-range")).toBe("bytes */0");
      expect(opened).toHaveLength(0);
    });

    it.each(["cancel", "abort"] as const)(
      "releases the reader and stops reads on %s",
      async (action) => {
        await prepare(Buffer.alloc(3 * 1024 * 1024, 7));
        const abort = new AbortController();
        const response = await respond({}, "GET", abort.signal);
        const reader = opened[0]!;
        const stream = response.body!.getReader();
        expect(reader.read).toHaveBeenCalledTimes(1);
        expect((await stream.read()).value!.every((byte) => byte === 7)).toBe(
          true,
        );
        expect(reader.read).toHaveBeenCalledTimes(1);
        if (action === "cancel") {
          await stream.cancel();
          expect((await stream.read()).done).toBe(true);
        } else {
          abort.abort();
          await expect(stream.read()).rejects.toThrow();
        }
        expect(reader.signal.aborted).toBe(true);
        expect(reader.close).toHaveBeenCalledTimes(1);
        expect(reader.read).toHaveBeenCalledTimes(1);
      },
    );

    it.each(["before headers", "after headers"] as const)(
      "closes the reader when a read fails %s",
      async (phase) => {
        await prepare(Buffer.alloc(3 * 1024 * 1024));
        if (phase === "before headers") {
          const open = source.open;
          source.open = async (signal) => {
            const reader = await open(signal);
            opened[0]!.read.mockRejectedValueOnce(new Error("read failed"));
            return reader;
          };
          await expect(respond()).rejects.toThrow("read failed");
        } else {
          const response = await respond();
          opened[0]!.read.mockRejectedValueOnce(new Error("read failed"));
          await expect(response.arrayBuffer()).rejects.toThrow("read failed");
        }
        expect(opened[0]!.close).toHaveBeenCalledTimes(1);
      },
    );

    if (kind === "local") {
      it.each(["before headers", "after headers"] as const)(
        "detects a local file change %s",
        async (phase) => {
          await prepare(Buffer.alloc(3 * 1024 * 1024));
          const response = phase === "after headers" ? await respond() : null;
          await writeFile(join(directory, "recording.mp4"), "changed");
          if (response)
            await expect(response.arrayBuffer()).rejects.toThrow(
              "File changed",
            );
          else await expect(respond()).rejects.toThrow("File changed");
          expect(opened[0]!.close).toHaveBeenCalledTimes(1);
        },
      );
    }

    it("finishes multiple chunks including a short final chunk and closes the reader", async () => {
      const content = Buffer.alloc(1024 * 1024 + 3, 5);
      await prepare(content);
      const response = await respond();
      expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
      expect(opened[0]!.read.mock.calls.length).toBeGreaterThan(1);
      expect(opened[0]!.read.mock.lastCall?.[1]).toBe(3);
      expect(opened[0]!.close).toHaveBeenCalledTimes(1);
    });
  },
);
