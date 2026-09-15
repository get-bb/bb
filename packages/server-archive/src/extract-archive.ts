import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { assertServerArchiveFormat } from "./archive-format.js";
import { hasErrorCode, ServerArchiveError } from "./errors.js";
import {
  parseServerArchiveManifest,
  SERVER_ARCHIVE_FILES_DIR_NAME,
  SERVER_ARCHIVE_MANIFEST_PATH,
  type ServerArchiveManifest,
  type ServerArchiveManifestEntry,
} from "./manifest.js";
import { isSafeRelativePath, resolveRelativePath } from "./relative-path.js";
import { TarReader } from "./tar-format.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

export interface ExtractServerArchiveArgs {
  archivePath: string;
  destinationDir: string;
}

async function assertEmptyDestination(destinationDir: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true });
  if ((await readdir(destinationDir)).length > 0) {
    throw new Error(
      `Archive extraction destination ${destinationDir} is not empty`,
    );
  }
}

function extractedFileMode(mode: number | null): number {
  return mode === null ? 0o600 : (mode & 0o755) | 0o600;
}

function manifestPathForEntry(entryPath: string): string {
  const prefix = `${SERVER_ARCHIVE_FILES_DIR_NAME}/`;
  const relativePath = entryPath.startsWith(prefix)
    ? entryPath.slice(prefix.length)
    : null;
  if (relativePath === null || !isSafeRelativePath(relativePath)) {
    throw new ServerArchiveError(
      "unsafe_entry",
      `Archive entry ${JSON.stringify(entryPath)} is not a safe path under ${prefix}`,
    );
  }
  return relativePath;
}

function parseManifestJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ServerArchiveError("corrupt", "Archive manifest is not JSON", {
      cause: error,
    });
  }
}

async function extractEntryFile(
  reader: TarReader,
  destinationPath: string,
  mode: number,
  expected: ServerArchiveManifestEntry,
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  const hash = createHash("sha256");
  try {
    await pipeline(
      reader.readBody(),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(destinationPath, { flags: "wx", mode }),
    );
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new ServerArchiveError(
        "unsafe_entry",
        `Archive entry ${expected.path} collides with another extracted file`,
        { cause: error },
      );
    }
    throw error;
  }
  if (hash.digest("hex") !== expected.sha256) {
    throw new ServerArchiveError(
      "digest_mismatch",
      `Archive entry ${expected.path} does not match its manifest digest`,
    );
  }
}

async function extractTarEntries(
  source: AsyncIterable<Buffer>,
  destinationDir: string,
): Promise<ServerArchiveManifest> {
  const reader = new TarReader(source);
  const first = await reader.nextEntry();
  if (
    first === null ||
    first.type !== "File" ||
    first.path !== SERVER_ARCHIVE_MANIFEST_PATH
  ) {
    throw new ServerArchiveError(
      "corrupt",
      `Archive does not start with ${SERVER_ARCHIVE_MANIFEST_PATH}`,
    );
  }
  if (first.size > MAX_MANIFEST_BYTES) {
    throw new ServerArchiveError("corrupt", "Archive manifest is too large");
  }
  const manifest = parseServerArchiveManifest(
    parseManifestJson(await reader.readBodyBuffer()),
  );
  const pendingEntries = new Map(
    manifest.entries.map((entry) => [entry.path, entry]),
  );
  const filesDir = join(destinationDir, SERVER_ARCHIVE_FILES_DIR_NAME);
  for (;;) {
    const entry = await reader.nextEntry();
    if (entry === null) {
      break;
    }
    if (entry.type !== "File") {
      throw new ServerArchiveError(
        "unsafe_entry",
        `Archive entry ${JSON.stringify(entry.path)} has unsupported type ${entry.type}`,
      );
    }
    const relativePath = manifestPathForEntry(entry.path);
    const expected = pendingEntries.get(relativePath);
    if (expected === undefined) {
      throw new ServerArchiveError(
        "unsafe_entry",
        `Archive entry ${relativePath} is not listed in the manifest`,
      );
    }
    pendingEntries.delete(relativePath);
    if (entry.size !== expected.size) {
      throw new ServerArchiveError(
        "digest_mismatch",
        `Archive entry ${relativePath} is ${String(entry.size)} bytes but the manifest lists ${String(expected.size)}`,
      );
    }
    await extractEntryFile(
      reader,
      resolveRelativePath(filesDir, relativePath),
      extractedFileMode(entry.mode),
      expected,
    );
  }
  if (pendingEntries.size > 0) {
    throw new ServerArchiveError(
      "corrupt",
      `Archive is missing ${String(pendingEntries.size)} file(s) listed in its manifest`,
    );
  }
  return manifest;
}

function normalizeExtractionError(error: unknown): unknown {
  if (error instanceof ServerArchiveError) {
    return error;
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("Z_")
  ) {
    return new ServerArchiveError(
      "corrupt",
      `Archive data is corrupt: ${error.message}`,
      { cause: error },
    );
  }
  return error;
}

export async function extractServerArchive(
  args: ExtractServerArchiveArgs,
): Promise<ServerArchiveManifest> {
  await assertServerArchiveFormat(args.archivePath);
  await assertEmptyDestination(args.destinationDir);
  const extracted: { manifest: ServerArchiveManifest | null } = {
    manifest: null,
  };
  const consume = async (source: AsyncIterable<Buffer>): Promise<void> => {
    extracted.manifest = await extractTarEntries(source, args.destinationDir);
  };
  try {
    await pipeline(createReadStream(args.archivePath), createGunzip(), consume);
  } catch (error) {
    await rm(join(args.destinationDir, SERVER_ARCHIVE_FILES_DIR_NAME), {
      force: true,
      recursive: true,
    });
    throw normalizeExtractionError(error);
  }
  if (extracted.manifest === null) {
    throw new ServerArchiveError("corrupt", "Archive has no manifest");
  }
  return extracted.manifest;
}
