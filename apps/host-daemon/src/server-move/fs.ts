import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

interface WriteFileAtomicallyArgs {
  path: string;
  content: string;
  mode: number;
}

export async function writeFileAtomically(
  args: WriteFileAtomicallyArgs,
): Promise<void> {
  const directory = dirname(args.path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(args.path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, args.content, {
      encoding: "utf8",
      mode: args.mode,
    });
    await rename(temporaryPath, args.path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function expandHomePath(path: string, homeDir: string): string {
  if (path === "~") {
    return homeDir;
  }
  return path.startsWith("~/") ? join(homeDir, path.slice(2)) : path;
}

export async function canonicalPath(path: string): Promise<string> {
  const resolved = resolve(path);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

export async function isSameOrInsidePath(
  candidate: string,
  root: string,
): Promise<boolean> {
  const relativePath = relative(
    await canonicalPath(root),
    await canonicalPath(candidate),
  );
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

export async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (
      !isFileNotFoundError(error) &&
      !(
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOTEMPTY" || error.code === "EEXIST")
      )
    ) {
      throw error;
    }
  }
}

export function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
