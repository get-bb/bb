import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { isFsErrorWithCode } from "./fs-errors.js";

export interface VerifiedFileExpectation {
  maxBytes: number;
  sha256: string | null;
  sizeBytes: number | null;
}

export type VerifiedFileMode =
  | { kind: "create"; mode: number }
  | { kind: "exact"; mode: number };

export interface WrittenFile {
  sha256: string;
  sizeBytes: number;
}

export class FileTransferVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileTransferVerificationError";
  }
}

function assertWithinLimits(
  label: string,
  expected: VerifiedFileExpectation,
  sizeBytes: number,
): void {
  if (expected.sizeBytes !== null && sizeBytes > expected.sizeBytes) {
    throw new FileTransferVerificationError(
      `${label} size mismatch: expected ${expected.sizeBytes} bytes, received more than ${expected.sizeBytes}`,
    );
  }
  if (sizeBytes > expected.maxBytes) {
    throw new FileTransferVerificationError(
      `${label} exceeds ${expected.maxBytes} byte limit: received ${sizeBytes}`,
    );
  }
}

async function writeFully(
  handle: FileHandle,
  chunk: Uint8Array,
): Promise<void> {
  for (let offset = 0; offset < chunk.byteLength; ) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
    );
    if (bytesWritten === 0) {
      throw new Error("File write made no progress");
    }
    offset += bytesWritten;
  }
}

async function* readFileChunks(filePath: string): AsyncGenerator<Uint8Array> {
  for await (const chunk of createReadStream(filePath)) {
    yield chunk as Buffer;
  }
}

export async function writeVerifiedFile(args: {
  destinationPath: string;
  durable: boolean;
  expected: VerifiedFileExpectation;
  label: string;
  mode: VerifiedFileMode;
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}): Promise<WrittenFile> {
  const handle = await fs.open(args.destinationPath, "wx", args.mode.mode);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    for await (const chunk of args.source) {
      sizeBytes += chunk.byteLength;
      assertWithinLimits(args.label, args.expected, sizeBytes);
      hash.update(chunk);
      await writeFully(handle, chunk);
    }
    if (
      args.expected.sizeBytes !== null &&
      sizeBytes !== args.expected.sizeBytes
    ) {
      throw new FileTransferVerificationError(
        `${args.label} size mismatch: expected ${args.expected.sizeBytes} bytes, received ${sizeBytes}`,
      );
    }
    const sha256 = hash.digest("hex");
    if (args.expected.sha256 !== null && sha256 !== args.expected.sha256) {
      throw new FileTransferVerificationError(
        `${args.label} content hash mismatch: expected ${args.expected.sha256}, received ${sha256}`,
      );
    }
    if (args.mode.kind === "exact") {
      await handle.chmod(args.mode.mode);
    }
    if (args.durable) {
      await handle.sync();
    }
    await handle.close();
    return { sha256, sizeBytes };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(args.destinationPath, { force: true });
    throw error;
  }
}

export async function copyVerifiedFile(args: {
  destinationPath: string;
  expected: VerifiedFileExpectation;
  label: string;
  mode: number;
  sourcePath: string;
}): Promise<WrittenFile> {
  return writeVerifiedFile({
    destinationPath: args.destinationPath,
    durable: false,
    expected: args.expected,
    label: args.label,
    mode: { kind: "exact", mode: args.mode },
    source: readFileChunks(args.sourcePath),
  });
}

export async function hashFile(filePath: string): Promise<WrittenFile> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = chunk as Buffer;
    sizeBytes += bytes.byteLength;
    hash.update(bytes);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function publishFileWithoutReplacing(
  sourcePath: string,
  destinationPath: string,
): Promise<boolean> {
  try {
    await fs.link(sourcePath, destinationPath);
    return true;
  } catch (error) {
    if (isFsErrorWithCode(error, "EEXIST")) return false;
    if (
      !["EPERM", "ENOTSUP", "EXDEV", "ENOSYS", "EMLINK"].some((code) =>
        isFsErrorWithCode(error, code),
      )
    ) {
      throw error;
    }
  }
  try {
    await fs.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if (isFsErrorWithCode(error, "EEXIST")) return false;
    await fs.rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function* takeExactBytes(
  reader: ChunkReader,
  byteLength: number,
): AsyncGenerator<Uint8Array> {
  let remaining = byteLength;
  while (remaining > 0) {
    const chunk = await reader.read(remaining);
    if (chunk === null) {
      throw new FileTransferVerificationError(
        `Transfer ended ${remaining} bytes early`,
      );
    }
    remaining -= chunk.byteLength;
    yield chunk;
  }
}

export class ChunkReader {
  readonly #iterator: AsyncIterator<Uint8Array>;
  #pending: Uint8Array | null = null;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.#iterator = source[Symbol.asyncIterator]();
  }

  async read(maxBytes: number): Promise<Uint8Array | null> {
    let chunk = this.#pending;
    this.#pending = null;
    while (chunk === null || chunk.byteLength === 0) {
      const next = await this.#iterator.next();
      if (next.done) return null;
      chunk = next.value;
    }
    if (chunk.byteLength <= maxBytes) return chunk;
    this.#pending = chunk.subarray(maxBytes);
    return chunk.subarray(0, maxBytes);
  }

  async assertEnded(): Promise<void> {
    if ((await this.read(1)) !== null) {
      throw new FileTransferVerificationError(
        "Transfer returned more bytes than requested",
      );
    }
  }

  async cancel(): Promise<void> {
    await this.#iterator.return?.();
  }
}
