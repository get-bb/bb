import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function isFileNotFoundError(cause) {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export async function writeGeneratedFile(filePath, content) {
  const current = await readFile(filePath, "utf8").catch((error) => {
    if (isFileNotFoundError(error)) {
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
      if (isFileNotFoundError(unlinkError)) return;
      throw unlinkError;
    });
    throw error;
  }
  return true;
}
