// oxlint-disable-next-line no-restricted-imports
import { open } from "node:fs/promises";
// oxlint-disable-next-line no-restricted-imports
import type { Stats } from "node:fs";
import { ApiError } from "../../errors.js";
import type { FileResponseSource } from "./file-stream-response.js";

export function createLocalFileSource(
  path: string,
  metadata: Stats,
): FileResponseSource {
  return {
    sizeBytes: metadata.size,
    entityTag: `"${metadata.size.toString(16)}-${Math.floor(metadata.mtimeMs).toString(16)}"`,
    lastModified: metadata.mtime.toUTCString(),
    async open(signal) {
      signal.throwIfAborted();
      const handle = await open(path, "r");
      return {
        maxChunkBytes: 64 * 1024,
        async read(offset, length) {
          signal.throwIfAborted();
          const bytes = Buffer.alloc(length);
          const { bytesRead } = await handle.read(bytes, 0, length, offset);
          const current = await handle.stat();
          if (
            current.dev !== metadata.dev ||
            current.ino !== metadata.ino ||
            current.size !== metadata.size ||
            current.mtimeMs !== metadata.mtimeMs
          ) {
            throw new ApiError(
              409,
              "file_changed",
              "File changed during read; retry the request",
              true,
            );
          }
          return bytes.subarray(0, bytesRead);
        },
        close: () => handle.close(),
      };
    },
  };
}
