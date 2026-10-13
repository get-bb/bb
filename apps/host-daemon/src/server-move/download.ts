import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FetchFn } from "../server-client.js";
import { CommandDispatchError } from "../command-dispatch-support.js";
import { isFileNotFoundError } from "./fs.js";

export const SERVER_MOVE_DOWNLOAD_FAILED = "server_move_download_failed";
export const SERVER_MOVE_DIGEST_MISMATCH = "server_move_digest_mismatch";

export interface DownloadVerifiedFileArgs {
  fetchFn: FetchFn;
  url: string;
  headers: Record<string, string>;
  destinationPath: string;
  expectedSha256: string;
  expectedSizeBytes: number | null;
  maxSizeBytes: number;
  signal: AbortSignal;
  onProgress: (receivedBytes: number) => void;
}

async function hashFile(path: string): Promise<{
  sha256: string;
  sizeBytes: number;
} | null> {
  try {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      sizeBytes += bytes.byteLength;
    }
    return { sha256: hash.digest("hex"), sizeBytes };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function isVerifiedFile(
  args: DownloadVerifiedFileArgs,
): Promise<boolean> {
  const existing = await hashFile(args.destinationPath);
  if (existing === null) {
    return false;
  }
  if (
    existing.sha256 === args.expectedSha256 &&
    (args.expectedSizeBytes === null ||
      existing.sizeBytes === args.expectedSizeBytes)
  ) {
    return true;
  }
  await rm(args.destinationPath, { force: true });
  return false;
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^[0-9]+$/u.test(value.trim())) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveDownloadSize(args: {
  contentLength: number | null;
  expectedSizeBytes: number | null;
  maxSizeBytes: number;
  pathname: string;
}): number {
  if (
    args.expectedSizeBytes !== null &&
    args.contentLength !== null &&
    args.contentLength !== args.expectedSizeBytes
  ) {
    throw new CommandDispatchError(
      SERVER_MOVE_DIGEST_MISMATCH,
      `Download of ${args.pathname} reports ${args.contentLength} bytes, expected ${args.expectedSizeBytes}`,
    );
  }
  const size = args.expectedSizeBytes ?? args.contentLength;
  if (size === null) {
    throw new CommandDispatchError(
      SERVER_MOVE_DOWNLOAD_FAILED,
      `Download of ${args.pathname} did not report its size`,
    );
  }
  if (size > args.maxSizeBytes) {
    throw new CommandDispatchError(
      SERVER_MOVE_DOWNLOAD_FAILED,
      `Download of ${args.pathname} is ${size} bytes, over the ${args.maxSizeBytes}-byte limit`,
    );
  }
  return size;
}

export async function downloadVerifiedFile(
  args: DownloadVerifiedFileArgs,
): Promise<void> {
  if (await isVerifiedFile(args)) {
    return;
  }
  await mkdir(dirname(args.destinationPath), { recursive: true });
  const response = await args.fetchFn(args.url, {
    method: "GET",
    headers: args.headers,
    signal: args.signal,
  });
  const pathname = new URL(args.url).pathname;
  if (!response.ok || response.body === null) {
    await response.body?.cancel().catch(() => undefined);
    throw new CommandDispatchError(
      SERVER_MOVE_DOWNLOAD_FAILED,
      `Download of ${pathname} failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = response.body;
  let sizeBytes: number;
  try {
    sizeBytes = resolveDownloadSize({
      contentLength: parseContentLength(response.headers.get("content-length")),
      expectedSizeBytes: args.expectedSizeBytes,
      maxSizeBytes: args.maxSizeBytes,
      pathname,
    });
  } catch (error) {
    await body.cancel().catch(() => undefined);
    throw error;
  }
  const partialPath = `${args.destinationPath}.partial`;
  const hash = createHash("sha256");
  let receivedBytes = 0;
  async function* verifiedChunks(): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          return;
        }
        receivedBytes += result.value.byteLength;
        if (receivedBytes > sizeBytes) {
          throw new CommandDispatchError(
            SERVER_MOVE_DIGEST_MISMATCH,
            `Download of ${pathname} exceeded the expected ${sizeBytes} bytes`,
          );
        }
        hash.update(result.value);
        args.onProgress(receivedBytes);
        yield result.value;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  try {
    await pipeline(
      verifiedChunks,
      createWriteStream(partialPath, { mode: 0o600 }),
    );
    if (receivedBytes !== sizeBytes) {
      throw new CommandDispatchError(
        SERVER_MOVE_DIGEST_MISMATCH,
        `Download size mismatch: expected ${sizeBytes} bytes, received ${receivedBytes}`,
      );
    }
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== args.expectedSha256) {
      throw new CommandDispatchError(
        SERVER_MOVE_DIGEST_MISMATCH,
        `Download digest mismatch: expected ${args.expectedSha256}, received ${actualSha256}`,
      );
    }
    await rename(partialPath, args.destinationPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}
