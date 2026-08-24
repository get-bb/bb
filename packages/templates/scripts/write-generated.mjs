import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Write a generated file only when its content changed, so file watchers and
 * mtimes stay quiet on no-op regeneration. The write is atomic (temp file +
 * rename) so a concurrent reader never sees a half-written module.
 */
export async function writeGeneratedFile(filePath, content) {
  const current = await readFile(filePath, "utf8").catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (current === content) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError) => {
      if (unlinkError && unlinkError.code === "ENOENT") return;
      throw unlinkError;
    });
    throw error;
  }
  return true;
}
