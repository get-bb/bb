import { join } from "node:path";
import { z } from "zod";

const MAX_RELATIVE_PATH_BYTES = 4096;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    Buffer.byteLength(value) > MAX_RELATIVE_PATH_BYTES ||
    value.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

export const safeRelativePathSchema = z.string().refine(isSafeRelativePath, {
  message: "Expected a relative POSIX path without '.' or '..' segments",
});

export function findRelativePathConflict(
  paths: readonly string[],
): string | null {
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      return path;
    }
    seen.add(path);
  }
  for (const path of paths) {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      if (seen.has(segments.slice(0, depth).join("/"))) {
        return path;
      }
    }
  }
  return null;
}

export function resolveRelativePath(
  root: string,
  relativePath: string,
): string {
  return join(root, ...relativePath.split("/"));
}
