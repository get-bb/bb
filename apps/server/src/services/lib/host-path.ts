import { joinHostPath } from "@bb/domain";

export function joinHostPathSegments(
  rootPath: string,
  ...segments: string[]
): string {
  const joined = joinHostPath({
    rootPath,
    relativePath: segments.join("/"),
  });
  if (joined === null) {
    throw new Error(`Host path is not absolute: ${rootPath}`);
  }
  return joined;
}
