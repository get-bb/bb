import path from "node:path";

export const TYPST_FILE_EXTENSION = ".typ";

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value.trim();
}

export function requireRelativeSourceFile(value: unknown): string {
  const file = requireNonEmptyString(value, "file");
  if (path.isAbsolute(file)) {
    throw new Error(`"file" must be source-relative, not absolute: ${file}`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(file) || file.startsWith("\\\\")) {
    throw new Error(`"file" must be source-relative, not absolute: ${file}`);
  }
  const slashNormalized = file.replace(/\\/g, "/");
  if (slashNormalized.includes("\0")) {
    throw new Error(`"file" must not contain null bytes: ${file}`);
  }
  if (slashNormalized.split("/").includes("..")) {
    throw new Error(`"file" must not contain traversal segments: ${file}`);
  }
  const normalized = path.posix.normalize(slashNormalized);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === "." ||
    normalized.startsWith("/")
  ) {
    throw new Error(`"file" must not escape its source: ${file}`);
  }
  return normalized;
}

export function requireRelativeTypstFile(value: unknown): string {
  const file = requireRelativeSourceFile(value);
  if (path.posix.extname(file).toLowerCase() !== TYPST_FILE_EXTENSION) {
    throw new Error(
      `"file" must end with ${TYPST_FILE_EXTENSION}, got ${JSON.stringify(file)}`,
    );
  }
  return file;
}

export function resolveContainedSourcePath(
  rootPath: string,
  relativeFile: string,
): string {
  const root = path.resolve(rootPath);
  const absolute = path.resolve(root, relativeFile);
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`"file" must not escape its source: ${relativeFile}`);
  }
  return absolute;
}
