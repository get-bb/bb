import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { appSourceNameSchema } from "@bb/domain";
import type { AppSourceRef } from "@bb/server-contract";
import { isFsErrorWithCode } from "../lib/fs-errors.js";

export const APP_SOURCE_PROVENANCE_FILE_NAME = ".bb-app-source.json";

/**
 * Written into an installed app's root by every sync. `files` maps each
 * synced file's app-relative path to its sha256 and is the baseline for
 * divergence detection: any add, edit, or delete relative to this snapshot
 * marks the app as locally modified.
 */
const appSourceProvenanceSchema = z
  .object({
    sourceName: appSourceNameSchema,
    commitSha: z.string().min(1),
    syncedAt: z.iso.datetime(),
    files: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict();
export type AppSourceProvenance = z.infer<typeof appSourceProvenanceSchema>;

function provenanceFilePath(appRootPath: string): string {
  return path.join(appRootPath, APP_SOURCE_PROVENANCE_FILE_NAME);
}

/**
 * Returns null when the marker is missing or unreadable. A hand-corrupted
 * marker therefore behaves like a detach: the app reads as locally managed
 * and the owning source reports a conflict on its next sync.
 */
export async function readAppSourceProvenance(
  appRootPath: string,
): Promise<AppSourceProvenance | null> {
  let raw: string;
  try {
    raw = await readFile(provenanceFilePath(appRootPath), "utf8");
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  try {
    return appSourceProvenanceSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readAppSourceRef(
  appRootPath: string,
): Promise<AppSourceRef | null> {
  const provenance = await readAppSourceProvenance(appRootPath);
  return provenance === null
    ? null
    : { name: provenance.sourceName, commitSha: provenance.commitSha };
}

export async function writeAppSourceProvenance(
  appRootPath: string,
  provenance: AppSourceProvenance,
): Promise<void> {
  await writeFile(
    provenanceFilePath(appRootPath),
    `${JSON.stringify(appSourceProvenanceSchema.parse(provenance), null, 2)}\n`,
    "utf8",
  );
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

/**
 * Hashes every regular file under the app root, keyed by app-relative path
 * with `/` separators. The provenance marker itself is excluded; symlinks and
 * other special entries are ignored, matching what sync materializes.
 */
export async function computeAppFileHashes(
  appRootPath: string,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  async function walk(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = path
        .relative(appRootPath, entryPath)
        .split(path.sep)
        .join("/");
      if (relativePath === APP_SOURCE_PROVENANCE_FILE_NAME) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      hashes[relativePath] = await hashFile(entryPath);
    }
  }

  await walk(appRootPath);
  return hashes;
}

export function fileHashesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftPaths = Object.keys(left);
  if (leftPaths.length !== Object.keys(right).length) {
    return false;
  }
  return leftPaths.every((filePath) => left[filePath] === right[filePath]);
}
