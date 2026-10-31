import {
  getHostPathBasename,
  getHostPathDirname,
  joinHostPath,
} from "@bb/domain";

function requireAbsoluteHostPathResult<T>(result: T | null, path: string): T {
  if (result === null) {
    throw new Error(`Host path is not absolute: ${path}`);
  }
  return result;
}

export function joinHostPathSegments(
  rootPath: string,
  ...segments: string[]
): string {
  return requireAbsoluteHostPathResult(
    joinHostPath({ rootPath, relativePath: segments.join("/") }),
    rootPath,
  );
}

export function hostPathDirname(path: string): string {
  return requireAbsoluteHostPathResult(getHostPathDirname(path), path);
}

export function hostPathBasename(path: string): string {
  return requireAbsoluteHostPathResult(getHostPathBasename(path), path);
}
