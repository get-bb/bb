import { open } from "node:fs/promises";
import { ServerArchiveError } from "./errors.js";

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const OLD_ENCRYPTED_ARCHIVE_MAGIC = Buffer.from("BBSA", "ascii");

async function readArchivePrefix(archivePath: string): Promise<Buffer> {
  const handle = await open(archivePath, "r");
  try {
    const buffer = Buffer.alloc(OLD_ENCRYPTED_ARCHIVE_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function assertServerArchiveFormat(
  archivePath: string,
): Promise<void> {
  const prefix = await readArchivePrefix(archivePath);
  if (prefix.equals(OLD_ENCRYPTED_ARCHIVE_MAGIC)) {
    throw new ServerArchiveError(
      "unsupported_version",
      "This export was encrypted by an older bb; re-export it with bb server export",
    );
  }
  if (
    prefix.length < GZIP_MAGIC.length ||
    !prefix.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)
  ) {
    throw new ServerArchiveError("corrupt", "File is not a bb server archive");
  }
}
