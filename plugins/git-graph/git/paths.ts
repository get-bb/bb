export function isValidRelativeFilePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("-")) return false;
  if (
    /^[a-zA-Z]:/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    return false;
  }
  if (/[\0-\x1f]/u.test(value)) return false;
  const segments = value.split(/[\\/]/u);
  return segments.every((segment) => segment !== ".." && segment.length > 0);
}

export function repoRelPathFormError(relPath: string): string | null {
  if (relPath.length > 1024) return "repository path is too long";
  if (/[\0-\x1f]/u.test(relPath))
    return "repository path has invalid characters";
  if (relPath === "") return null;
  if (relPath.startsWith("/") || relPath.startsWith("\\")) {
    return "repository path must be relative";
  }
  if (/^[a-zA-Z]:/u.test(relPath)) {
    return "repository path must be relative";
  }
  const segments = relPath.split("/");
  let dotDotAllowed = true;
  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") {
      return "repository path has empty segments";
    }
    if (segment === "..") {
      if (!dotDotAllowed) {
        return "repository path may only climb with a leading .. prefix";
      }
      continue;
    }
    dotDotAllowed = false;
  }
  return null;
}
