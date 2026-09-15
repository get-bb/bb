import { constants, createWriteStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { type FileHandle, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  createArchiveEncryptor,
  type ServerArchiveEncryption,
} from "./encryption.js";
import { hasErrorCode, ServerArchiveError } from "./errors.js";
import {
  SERVER_ARCHIVE_FILES_DIR_NAME,
  SERVER_ARCHIVE_FORMAT,
  SERVER_ARCHIVE_MANIFEST_PATH,
  SERVER_ARCHIVE_VERSION,
  type ServerArchiveManifest,
  type ServerArchiveManifestEntry,
  type ServerArchiveManifestInput,
  serverArchiveManifestSchema,
} from "./manifest.js";
import { findRelativePathConflict } from "./relative-path.js";
import { isServerOwnedPath } from "./server-owned-paths.js";
import {
  encodeTarFileHeader,
  TAR_END_OF_ARCHIVE,
  tarPadding,
} from "./tar-format.js";

const READ_CHUNK_BYTES = 256 * 1024;

export interface ServerArchiveSourceFile {
  sourcePath: string;
  archivePath: string;
}

export interface WriteServerArchiveArgs {
  outPath: string;
  files: readonly ServerArchiveSourceFile[];
  manifest: ServerArchiveManifestInput;
  encryption: ServerArchiveEncryption | null;
}

export interface WriteServerArchiveResult {
  sha256: string;
  sizeBytes: number;
  manifest: ServerArchiveManifest;
}

interface PlannedArchiveFile {
  sourcePath: string;
  mode: number;
  entry: ServerArchiveManifestEntry;
}

async function openSourceFile(sourcePath: string): Promise<FileHandle> {
  const handle = await open(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch((error: unknown) => {
    if (hasErrorCode(error, "ELOOP")) {
      throw new ServerArchiveError(
        "unsafe_entry",
        `${sourcePath} is a symbolic link`,
      );
    }
    throw error;
  });
  const stats = await handle.stat();
  if (!stats.isFile()) {
    await handle.close();
    throw new ServerArchiveError(
      "unsafe_entry",
      `${sourcePath} is not a regular file`,
    );
  }
  return handle;
}

async function* readFileChunks(
  handle: FileHandle,
  limit: number | null,
): AsyncGenerator<Buffer> {
  let position = 0;
  for (;;) {
    const length =
      limit === null
        ? READ_CHUNK_BYTES
        : Math.min(READ_CHUNK_BYTES, limit - position);
    if (length === 0) {
      return;
    }
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead === 0) {
      return;
    }
    position += bytesRead;
    yield bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  }
}

async function planArchiveFile(
  file: ServerArchiveSourceFile,
): Promise<PlannedArchiveFile> {
  const handle = await openSourceFile(file.sourcePath);
  try {
    const stats = await handle.stat();
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of readFileChunks(handle, null)) {
      hash.update(chunk);
      size += chunk.length;
    }
    return {
      sourcePath: file.sourcePath,
      mode: stats.mode & 0o777,
      entry: { path: file.archivePath, size, sha256: hash.digest("hex") },
    };
  } finally {
    await handle.close();
  }
}

async function* generateTarChunks(
  manifest: ServerArchiveManifest,
  plannedFiles: readonly PlannedArchiveFile[],
): AsyncGenerator<Buffer> {
  const mtime = new Date(manifest.createdAt);
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  yield encodeTarFileHeader({
    path: SERVER_ARCHIVE_MANIFEST_PATH,
    size: manifestBytes.length,
    mode: 0o600,
    mtime,
  });
  yield manifestBytes;
  yield tarPadding(manifestBytes.length);
  for (const file of plannedFiles) {
    yield encodeTarFileHeader({
      path: `${SERVER_ARCHIVE_FILES_DIR_NAME}/${file.entry.path}`,
      size: file.entry.size,
      mode: file.mode,
      mtime,
    });
    const handle = await openSourceFile(file.sourcePath);
    try {
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of readFileChunks(handle, file.entry.size)) {
        hash.update(chunk);
        size += chunk.length;
        yield chunk;
      }
      if (
        size !== file.entry.size ||
        hash.digest("hex") !== file.entry.sha256
      ) {
        throw new ServerArchiveError(
          "digest_mismatch",
          `${file.sourcePath} changed while the archive was being written`,
        );
      }
    } finally {
      await handle.close();
    }
    yield tarPadding(file.entry.size);
  }
  yield TAR_END_OF_ARCHIVE;
}

function assertArchivePaths(files: readonly ServerArchiveSourceFile[]): void {
  for (const file of files) {
    if (!isServerOwnedPath(file.archivePath)) {
      throw new ServerArchiveError(
        "unsafe_entry",
        `Archive path ${JSON.stringify(file.archivePath)} is not a server-owned path`,
      );
    }
  }
  const conflict = findRelativePathConflict(
    files.map((file) => file.archivePath),
  );
  if (conflict !== null) {
    throw new ServerArchiveError(
      "unsafe_entry",
      `Archive path ${conflict} conflicts with another entry`,
    );
  }
}

export async function writeServerArchive(
  args: WriteServerArchiveArgs,
): Promise<WriteServerArchiveResult> {
  assertArchivePaths(args.files);
  const plannedFiles: PlannedArchiveFile[] = [];
  for (const file of args.files) {
    plannedFiles.push(await planArchiveFile(file));
  }
  const manifest = serverArchiveManifestSchema.parse({
    ...args.manifest,
    format: SERVER_ARCHIVE_FORMAT,
    version: SERVER_ARCHIVE_VERSION,
    entries: plannedFiles.map((file) => file.entry),
  });
  const encryptor =
    args.encryption === null
      ? null
      : await createArchiveEncryptor(args.encryption);

  await mkdir(dirname(args.outPath), { recursive: true });
  const tempPath = join(
    dirname(args.outPath),
    `.${basename(args.outPath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const archiveHash = createHash("sha256");
  let sizeBytes = 0;
  try {
    await pipeline(
      Readable.from(generateTarChunks(manifest, plannedFiles)),
      createGzip(),
      async function* (source: AsyncIterable<Buffer>) {
        const record = (chunk: Buffer): Buffer => {
          archiveHash.update(chunk);
          sizeBytes += chunk.length;
          return chunk;
        };
        if (encryptor === null) {
          for await (const chunk of source) {
            yield record(chunk);
          }
          return;
        }
        yield record(encryptor.prefix);
        for await (const chunk of source) {
          yield record(encryptor.cipher.update(chunk));
        }
        yield record(encryptor.cipher.final());
        yield record(encryptor.cipher.getAuthTag());
      },
      createWriteStream(tempPath, { flags: "wx", mode: 0o600 }),
    );
    await rename(tempPath, args.outPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  return { sha256: archiveHash.digest("hex"), sizeBytes, manifest };
}
