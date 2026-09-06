import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const WINDOWS_FILE_LOCK_ERROR_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const WINDOWS_RENAME_RETRY_BUDGET_MS = 2000;
const WINDOWS_RENAME_RETRY_DELAY_MS = 10;

async function renameForPromotion(source, destination) {
  if (process.platform !== "win32") {
    await rename(source, destination);
    return;
  }
  const startedAt = Date.now();
  for (;;) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = error instanceof Error ? error.code : undefined;
      if (
        !WINDOWS_FILE_LOCK_ERROR_CODES.has(code) ||
        Date.now() - startedAt > WINDOWS_RENAME_RETRY_BUDGET_MS
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, WINDOWS_RENAME_RETRY_DELAY_MS),
      );
    }
  }
}

function toPortableEntry(value) {
  return value.split(path.sep).join("/");
}

async function removeUnexpectedFiles(dir, expectedFiles, relativeDir = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = toPortableEntry(path.join(relativeDir, entry.name));
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeUnexpectedFiles(absolutePath, expectedFiles, relativePath);
      const remaining = await readdir(absolutePath);
      if (remaining.length === 0) {
        await rm(absolutePath, { recursive: true });
      }
      continue;
    }
    if (!expectedFiles.has(relativePath)) {
      await rm(absolutePath);
    }
  }
}

/**
 * Promote a complete staged runtime build without first deleting the live
 * package exports. Each rename replaces one file atomically, so concurrent
 * consumers see either the previous complete artifact or its replacement.
 */
export async function promoteRuntimeEntries({
  distDir,
  stagingDir,
  relativeOutputs,
}) {
  await mkdir(distDir, { recursive: true });
  const outputs = relativeOutputs.map(toPortableEntry);
  for (const relativeOutput of outputs) {
    const destination = path.join(distDir, relativeOutput);
    await mkdir(path.dirname(destination), { recursive: true });
    await renameForPromotion(path.join(stagingDir, relativeOutput), destination);
  }
  await removeUnexpectedFiles(distDir, new Set(outputs));
}
