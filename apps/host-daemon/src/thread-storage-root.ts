import fs from "node:fs/promises";
import path from "node:path";

export function threadStorageRootPath(dataDir: string): string {
  return path.join(dataDir, "thread-storage");
}

export async function ensureThreadStorageRoot(
  dataDir: string,
): Promise<string> {
  const rootPath = threadStorageRootPath(dataDir);
  await fs.mkdir(rootPath, { mode: 0o700, recursive: true });
  await fs.chmod(rootPath, 0o700);
  return rootPath;
}
