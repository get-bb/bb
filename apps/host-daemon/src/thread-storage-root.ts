import fs from "node:fs/promises";
import path from "node:path";

interface ThreadStorageRootPathOptions {
  configuredRoot?: string;
}

export function threadStorageRootPath(
  dataDir: string,
  options: ThreadStorageRootPathOptions = {},
): string {
  const configuredRoot = options.configuredRoot;
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(configuredRoot);
  }
  return path.join(dataDir, "thread-storage");
}

export async function ensureThreadStorageRoot(
  dataDir: string,
  options: ThreadStorageRootPathOptions = {},
): Promise<string> {
  const rootPath = threadStorageRootPath(dataDir, options);
  await fs.mkdir(rootPath, { recursive: true });
  return rootPath;
}
