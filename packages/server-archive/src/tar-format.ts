import { Header } from "tar/header";
import { Pax } from "tar/pax";
import { ServerArchiveError } from "./errors.js";

const BLOCK_BYTES = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK_BYTES);
const MAX_EXTENDED_HEADER_BYTES = 1024 * 1024;
const MAX_TRAILING_BYTES = 1024 * 1024;

export const TAR_END_OF_ARCHIVE = Buffer.alloc(BLOCK_BYTES * 2);

export function tarPadding(size: number): Buffer {
  const remainder = size % BLOCK_BYTES;
  return remainder === 0
    ? Buffer.alloc(0)
    : Buffer.alloc(BLOCK_BYTES - remainder);
}

interface EncodeTarFileHeaderArgs {
  path: string;
  size: number;
  mode: number;
  mtime: Date;
}

export function encodeTarFileHeader(args: EncodeTarFileHeaderArgs): Buffer {
  const header = new Header({
    path: args.path,
    mode: args.mode,
    uid: 0,
    gid: 0,
    size: args.size,
    mtime: args.mtime,
    type: "File",
  });
  const needsExtendedHeader = header.encode();
  const block = header.block;
  if (block === undefined) {
    throw new Error(`Failed to encode tar header for ${args.path}`);
  }
  if (!needsExtendedHeader) {
    return block;
  }
  const extendedHeader = new Pax({
    path: args.path,
    size: args.size,
    mtime: args.mtime,
  }).encode();
  return Buffer.concat([extendedHeader, block]);
}

export interface TarEntryHeader {
  path: string;
  type: string;
  size: number;
  mode: number | null;
}

function corrupt(message: string): ServerArchiveError {
  return new ServerArchiveError("corrupt", message);
}

export class TarReader {
  readonly #source: AsyncIterator<Buffer>;
  #buffer: Buffer = Buffer.alloc(0);
  #sourceDone = false;
  #unreadBodyBytes = 0;

  constructor(source: AsyncIterable<Buffer>) {
    this.#source = source[Symbol.asyncIterator]();
  }

  async #pull(): Promise<boolean> {
    if (this.#sourceDone) {
      return false;
    }
    const next = await this.#source.next();
    if (next.done === true) {
      this.#sourceDone = true;
      return false;
    }
    this.#buffer =
      this.#buffer.length === 0
        ? next.value
        : Buffer.concat([this.#buffer, next.value]);
    return true;
  }

  async #readExact(length: number): Promise<Buffer | null> {
    while (this.#buffer.length < length) {
      if (!(await this.#pull())) {
        if (this.#buffer.length === 0) {
          return null;
        }
        throw corrupt("Archive is truncated");
      }
    }
    const chunk = this.#buffer.subarray(0, length);
    this.#buffer = this.#buffer.subarray(length);
    return chunk;
  }

  async #skipPadding(size: number): Promise<void> {
    const padding = tarPadding(size).length;
    if (padding > 0 && (await this.#readExact(padding)) === null) {
      throw corrupt("Archive is truncated");
    }
  }

  async #drainTrailingZeros(): Promise<void> {
    let trailingBytes = 0;
    for (;;) {
      trailingBytes += this.#buffer.length;
      if (trailingBytes > MAX_TRAILING_BYTES) {
        throw corrupt("Archive has unexpected trailing data");
      }
      if (!this.#buffer.equals(Buffer.alloc(this.#buffer.length))) {
        throw corrupt("Archive has unexpected trailing data");
      }
      this.#buffer = Buffer.alloc(0);
      if (!(await this.#pull())) {
        return;
      }
    }
  }

  async nextEntry(): Promise<TarEntryHeader | null> {
    if (this.#unreadBodyBytes > 0) {
      throw new Error("The previous tar entry body was not consumed");
    }
    let extended: Pax | undefined;
    for (;;) {
      const block = await this.#readExact(BLOCK_BYTES);
      if (block === null) {
        throw corrupt("Archive ended without an end-of-archive marker");
      }
      if (block.equals(ZERO_BLOCK)) {
        if (extended !== undefined) {
          throw corrupt("Archive ended after an extended header");
        }
        await this.#drainTrailingZeros();
        return null;
      }
      const header = new Header(block, 0, extended);
      if (!header.cksumValid) {
        throw corrupt("Archive entry header checksum is invalid");
      }
      const size = header.size;
      if (size === undefined || !Number.isSafeInteger(size)) {
        throw corrupt("Archive entry size is invalid");
      }
      if (header.type === "ExtendedHeader") {
        if (extended !== undefined) {
          throw corrupt("Archive has consecutive extended headers");
        }
        if (size > MAX_EXTENDED_HEADER_BYTES) {
          throw corrupt("Archive extended header is too large");
        }
        const body = await this.#readExact(size);
        if (body === null) {
          throw corrupt("Archive is truncated");
        }
        await this.#skipPadding(size);
        extended = Pax.parse(body.toString("utf8"), undefined, false);
        continue;
      }
      this.#unreadBodyBytes = size;
      return {
        path: header.path ?? "",
        type: header.type,
        size,
        mode: header.mode ?? null,
      };
    }
  }

  async readBodyBuffer(): Promise<Buffer> {
    const size = this.#unreadBodyBytes;
    const body = size === 0 ? Buffer.alloc(0) : await this.#readExact(size);
    if (body === null) {
      throw corrupt("Archive is truncated");
    }
    this.#unreadBodyBytes = 0;
    await this.#skipPadding(size);
    return Buffer.from(body);
  }

  async *readBody(): AsyncGenerator<Buffer> {
    const size = this.#unreadBodyBytes;
    while (this.#unreadBodyBytes > 0) {
      if (this.#buffer.length === 0 && !(await this.#pull())) {
        throw corrupt("Archive is truncated");
      }
      const take = Math.min(this.#unreadBodyBytes, this.#buffer.length);
      const chunk = this.#buffer.subarray(0, take);
      this.#buffer = this.#buffer.subarray(take);
      this.#unreadBodyBytes -= take;
      yield chunk;
    }
    await this.#skipPadding(size);
  }
}
