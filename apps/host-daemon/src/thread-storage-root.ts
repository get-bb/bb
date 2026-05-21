import fs from "node:fs/promises";
import path from "node:path";

export interface ThreadStorageRootPathOptions {
  env?: NodeJS.ProcessEnv;
}

export interface EnsureThreadStorageRootOptions
  extends ThreadStorageRootPathOptions {}

const THREAD_STORAGE_ENV_VAR = "BB_THREAD_STORAGE";

export function threadStorageRootPath(
  dataDir: string,
  options: ThreadStorageRootPathOptions = {},
): string {
  const configuredRoot = (options.env ?? process.env)[THREAD_STORAGE_ENV_VAR];
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(configuredRoot);
  }
  return path.join(dataDir, "thread-storage");
}

export async function ensureThreadStorageRoot(
  dataDir: string,
  options: EnsureThreadStorageRootOptions = {},
): Promise<string> {
  const rootPath = threadStorageRootPath(dataDir, options);
  await fs.mkdir(rootPath, { recursive: true });
  return rootPath;
}
