import { gunzipSync, inflateRawSync } from "node:zlib";

export type ArchiveFormat = "tar.gz" | "zip";

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

const TAR_BLOCK = 512;

function tarString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function tarSize(block: Buffer): number {
  const raw = tarString(block, 124, 12).trim();
  const size = Number.parseInt(raw === "" ? "0" : raw, 8);
  if (!Number.isFinite(size) || size < 0) {
    throw new ArchiveError("the tar archive has a corrupt entry size");
  }
  return size;
}

function extractTarMember(tar: Buffer, member: string): Buffer | null {
  let offset = 0;
  let longName: string | null = null;
  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) return null;
    const size = tarSize(header);
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + TAR_BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new ArchiveError("the tar archive is truncated");
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (type === "L") {
      longName = tarString(tar, dataStart, size);
      continue;
    }
    const prefix = tarString(header, 345, 155);
    const shortName = tarString(header, 0, 100);
    const name =
      longName ?? (prefix === "" ? shortName : `${prefix}/${shortName}`);
    longName = null;
    if ((type === "0" || type === "\0") && name === member) {
      return Buffer.from(tar.subarray(dataStart, dataEnd));
    }
  }
  return null;
}

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function findZipEnd(zip: Buffer): number {
  const earliest = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= earliest; offset -= 1) {
    if (zip.readUInt32LE(offset) === ZIP_END_SIGNATURE) return offset;
  }
  throw new ArchiveError("the zip archive has no central directory");
}

function extractZipMember(zip: Buffer, member: string): Buffer | null {
  const end = findZipEnd(zip);
  const entries = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index += 1) {
    if (zip.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw new ArchiveError("the zip archive has a corrupt central directory");
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== member) continue;
    if (zip.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new ArchiveError("the zip archive has a corrupt local header");
    }
    const dataStart =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    const content =
      method === 0
        ? Buffer.from(data)
        : method === 8
          ? inflateRawSync(data)
          : null;
    if (content === null) {
      throw new ArchiveError(`the zip archive uses compression ${method}`);
    }
    if (content.length !== size) {
      throw new ArchiveError("the zip archive member has the wrong size");
    }
    return content;
  }
  return null;
}

export function extractArchiveMember(
  archive: Uint8Array,
  format: ArchiveFormat,
  member: string,
): Buffer {
  const bytes = Buffer.from(archive);
  const content =
    format === "tar.gz"
      ? extractTarMember(gunzipSync(bytes), member)
      : extractZipMember(bytes, member);
  if (content === null) {
    throw new ArchiveError(`the archive has no ${member}`);
  }
  return content;
}
