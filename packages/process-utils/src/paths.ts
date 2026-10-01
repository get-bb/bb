import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

interface ResolveContainedPathArgs {
  rootPath: string;
  candidatePath: string;
}

export function resolveContainedPath(
  args: ResolveContainedPathArgs,
): string | null {
  const resolvedRootPath = resolve(args.rootPath);
  const resolvedCandidatePath = resolve(args.candidatePath);
  const relativePath = relative(resolvedRootPath, resolvedCandidatePath);

  if (relativePath === "") {
    return null;
  }

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }

  return resolvedCandidatePath;
}

export function isPathWithinDirectory(
  directoryPath: string,
  candidatePath: string,
): boolean {
  const relativePath = relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
