import { z } from "zod";
import { FirmwareCacheError } from "../cache/layout.js";
import { normalizeVirtualPath } from "../cache/path-safety.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const nullableString = z.string().nullable();

const snapshotFileSchema = z
  .object({
    file_path: z.string().min(1),
    file_hash: sha256Schema.nullable(),
    file_name: z.string().min(1),
    mime_type: nullableString,
    full_type: nullableString,
    file_size: z.number().int().nonnegative().nullable(),
  })
  .strict();

const unpackMetadataSchema = z
  .object({
    tried: z.array(z.string()),
    tried_version: z.string().optional(),
    used: z.string().optional(),
    used_version: z.string().optional(),
    error_type: z.string().optional(),
    error_msg: z.string().optional(),
  })
  .strict();

const rawSnapshotSchema = z
  .object({
    input_file: z.string().min(1),
    input_sha256: sha256Schema,
    file_tree: z.array(snapshotFileSchema),
    unpack_metadata: z.record(sha256Schema, unpackMetadataSchema),
    errors: z.array(z.json()),
  })
  .strict();

export interface SnapshotFile {
  filePath: string;
  fileHash: string | null;
  fileName: string;
  mimeType: string | null;
  fullType: string | null;
  fileSize: number | null;
}

export interface SnapshotUnpackMetadata {
  tried: string[];
  triedVersion?: string;
  used?: string;
  usedVersion?: string;
  errorType?: string;
  errorMsg?: string;
}

export interface Snapshot {
  inputFile: string;
  inputSha256: string;
  fileTree: SnapshotFile[];
  unpackMetadata: Record<string, SnapshotUnpackMetadata>;
  errors: unknown[];
}

export function validateMaxDepth(value: number | undefined): number {
  const depth = value ?? 12;
  if (!Number.isInteger(depth) || depth < 1 || depth > 12) {
    throw new FirmwareCacheError(
      "INVALID_UNPACK_DEPTH",
      "Firmware unpack depth must be an integer from 1 to 12.",
    );
  }
  return depth;
}

export function parseSnapshot(
  value: unknown,
  expectedInputSha256: string,
): Snapshot {
  const parsed = rawSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new FirmwareCacheError(
      "INVALID_UNPACK_SNAPSHOT",
      `snapshot.json does not match the standalone unpack contract: ${z.prettifyError(parsed.error)}`,
    );
  }
  if (parsed.data.input_sha256 !== expectedInputSha256) {
    throw new FirmwareCacheError(
      "UNPACK_INPUT_DIGEST_MISMATCH",
      "The extractor snapshot digest does not match the verified input image.",
    );
  }

  const paths = new Set<string>();
  const fileTree = parsed.data.file_tree.map((entry): SnapshotFile => {
    let filePath: string;
    try {
      filePath = normalizeVirtualPath(entry.file_path);
    } catch (error) {
      throw new FirmwareCacheError(
        "INVALID_UNPACK_SNAPSHOT",
        "snapshot.json contains an unsafe firmware path.",
        { cause: error },
      );
    }
    if (
      filePath === "/.__fs_invalid__" ||
      filePath.startsWith("/.__fs_invalid__/")
    ) {
      throw new FirmwareCacheError(
        "INVALID_UNPACK_SNAPSHOT",
        "snapshot.json uses the reserved invalid-node namespace.",
      );
    }
    if (paths.has(filePath)) {
      throw new FirmwareCacheError(
        "INVALID_UNPACK_SNAPSHOT",
        "snapshot.json contains duplicate firmware paths.",
      );
    }
    if (entry.file_name !== filePath.split("/").at(-1)) {
      throw new FirmwareCacheError(
        "INVALID_UNPACK_SNAPSHOT",
        "snapshot.json file_name does not match its firmware path.",
      );
    }
    paths.add(filePath);
    return {
      filePath,
      fileHash: entry.file_hash,
      fileName: entry.file_name,
      mimeType: entry.mime_type,
      fullType: entry.full_type,
      fileSize: entry.file_size,
    };
  });

  const unpackMetadata = Object.fromEntries(
    Object.entries(parsed.data.unpack_metadata).map(([hash, metadata]) => [
      hash,
      {
        tried: metadata.tried,
        ...(metadata.tried_version === undefined
          ? {}
          : { triedVersion: metadata.tried_version }),
        ...(metadata.used === undefined ? {} : { used: metadata.used }),
        ...(metadata.used_version === undefined
          ? {}
          : { usedVersion: metadata.used_version }),
        ...(metadata.error_type === undefined
          ? {}
          : { errorType: metadata.error_type }),
        ...(metadata.error_msg === undefined
          ? {}
          : { errorMsg: metadata.error_msg }),
      },
    ]),
  );

  return {
    inputFile: parsed.data.input_file,
    inputSha256: parsed.data.input_sha256,
    fileTree,
    unpackMetadata,
    errors: parsed.data.errors,
  };
}
