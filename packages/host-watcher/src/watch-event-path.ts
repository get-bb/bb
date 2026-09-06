import path from "node:path";

export function isExtendedLengthWindowsPath(candidatePath: string): boolean {
  return (
    candidatePath.startsWith("\\\\?\\") || candidatePath.startsWith("\\\\.\\")
  );
}

export function normalizeWatchEventPath(
  rootPath: string,
  eventPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (isExtendedLengthWindowsPath(eventPath)) {
    return eventPath;
  }
  if (platform === "win32") {
    if (isExtendedLengthWindowsPath(rootPath)) {
      return `${rootPath}\\${eventPath}`;
    }
    return path.win32.isAbsolute(eventPath)
      ? path.win32.normalize(eventPath)
      : path.win32.resolve(rootPath, eventPath);
  }
  return path.isAbsolute(eventPath)
    ? path.normalize(eventPath)
    : path.resolve(rootPath, eventPath);
}

function trimTrailingWindowsSeparators(candidatePath: string): string {
  const trimmed = candidatePath.replace(/[\\/]+$/u, "");
  return trimmed.length === 0 ? candidatePath : trimmed;
}

export function isWatchPathWithinRoot(
  rootPath: string,
  candidatePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") {
    const relativePath = path.relative(rootPath, candidatePath);
    return (
      relativePath.length === 0 ||
      (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
  }
  if (
    isExtendedLengthWindowsPath(rootPath) ||
    isExtendedLengthWindowsPath(candidatePath)
  ) {
    const foldedRoot = trimTrailingWindowsSeparators(rootPath).toLowerCase();
    const foldedCandidate = candidatePath.toLowerCase();
    return (
      foldedCandidate === foldedRoot ||
      foldedCandidate.startsWith(`${foldedRoot}\\`)
    );
  }
  const normalizedRoot = path.win32.normalize(rootPath);
  const normalizedCandidate = normalizeWatchEventPath(
    rootPath,
    candidatePath,
    platform,
  );
  const relativePath = path.win32.relative(
    normalizedRoot,
    normalizedCandidate,
  );
  return (
    relativePath.length === 0 ||
    (relativePath !== ".." &&
      !relativePath.startsWith("..\\") &&
      !path.win32.isAbsolute(relativePath))
  );
}

export function toWatchRootRelativeKey(
  rootPath: string,
  candidatePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return path
      .win32.relative(
        path.win32.normalize(rootPath),
        normalizeWatchEventPath(rootPath, candidatePath, platform),
      )
      .split(/[/\\]/u)
      .join("/");
  }
  return path.relative(rootPath, candidatePath).split(path.sep).join("/");
}

export function splitWatchRelativePath(
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return (
    platform === "win32"
      ? relativePath.split(/[/\\]/u)
      : relativePath.split(path.sep)
  ).filter(Boolean);
}

export function relativeWatchPath(
  rootPath: string,
  candidatePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? path.win32.relative(rootPath, candidatePath)
    : path.relative(rootPath, candidatePath);
}

export function dedupeWatchPathChanges<T extends { path: string; type: string }>(
  changes: readonly T[],
  platform: NodeJS.Platform = process.platform,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const change of changes) {
    const changePath =
      platform === "win32" ? change.path.toLowerCase() : change.path;
    const key = `${change.type}\0${changePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(change);
  }
  return result;
}
