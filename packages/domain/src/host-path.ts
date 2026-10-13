export type HostPathFlavor = "posix" | "windows";

interface ParsedHostPath {
  flavor: HostPathFlavor;
  root: string;
  segments: string[];
}

interface JoinHostPathArgs {
  rootPath: string;
  relativePath: string;
}

interface IsHostPathWithinArgs {
  rootPath: string;
  candidatePath: string;
}

const WINDOWS_DRIVE_PATH_PATTERN = /^([A-Za-z]):(?:[\\/]+|$)/u;
const WINDOWS_UNC_PATH_PATTERN = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/u;
const WINDOWS_SEPARATOR_PATTERN = /[\\/]+/u;

function collapseSegments(rawSegments: string[]): string[] {
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

function parseHostPath(path: string): ParsedHostPath | null {
  const drive = WINDOWS_DRIVE_PATH_PATTERN.exec(path);
  if (drive) {
    return {
      flavor: "windows",
      root: `${(drive[1] ?? "").toUpperCase()}:\\`,
      segments: collapseSegments(
        path.slice(drive[0].length).split(WINDOWS_SEPARATOR_PATTERN),
      ),
    };
  }
  const unc = WINDOWS_UNC_PATH_PATTERN.exec(path);
  if (unc) {
    return {
      flavor: "windows",
      root: `\\\\${unc[1] ?? ""}\\${unc[2] ?? ""}\\`,
      segments: collapseSegments(
        path.slice(unc[0].length).split(WINDOWS_SEPARATOR_PATTERN),
      ),
    };
  }
  if (path.startsWith("/")) {
    return {
      flavor: "posix",
      root: "/",
      segments: collapseSegments(path.split("/")),
    };
  }
  return null;
}

function formatHostPath(parsed: ParsedHostPath): string {
  if (parsed.flavor === "posix") {
    return `/${parsed.segments.join("/")}`;
  }
  if (parsed.segments.length === 0) {
    return parsed.root;
  }
  return `${parsed.root}${parsed.segments.join("\\")}`;
}

function comparisonSegments(parsed: ParsedHostPath): string[] {
  return parsed.flavor === "windows"
    ? parsed.segments.map((segment) => segment.toLowerCase())
    : parsed.segments;
}

function comparisonRoot(parsed: ParsedHostPath): string {
  return parsed.flavor === "windows" ? parsed.root.toLowerCase() : parsed.root;
}

export function getHostPathFlavor(path: string): HostPathFlavor | null {
  return parseHostPath(path)?.flavor ?? null;
}

export function isWindowsHostPath(path: string): boolean {
  return getHostPathFlavor(path) === "windows";
}

export function isWindowsUncHostPath(path: string): boolean {
  return WINDOWS_UNC_PATH_PATTERN.test(path);
}

export function isAbsoluteHostPath(path: string): boolean {
  return parseHostPath(path) !== null;
}

export function isHostPathRoot(path: string): boolean {
  const parsed = parseHostPath(path);
  return parsed !== null && parsed.segments.length === 0;
}

export function normalizeHostPath(path: string): string | null {
  const parsed = parseHostPath(path);
  return parsed === null ? null : formatHostPath(parsed);
}

export function getHostPathComparisonKey(path: string): string | null {
  const parsed = parseHostPath(path);
  if (parsed === null) {
    return null;
  }
  return formatHostPath({
    flavor: parsed.flavor,
    root: comparisonRoot(parsed),
    segments: comparisonSegments(parsed),
  });
}

export function areHostPathsEqual(left: string, right: string): boolean {
  const leftKey = getHostPathComparisonKey(left);
  return leftKey !== null && leftKey === getHostPathComparisonKey(right);
}

export function isHostPathWithin({
  rootPath,
  candidatePath,
}: IsHostPathWithinArgs): boolean {
  const root = parseHostPath(rootPath);
  const candidate = parseHostPath(candidatePath);
  if (
    root === null ||
    candidate === null ||
    root.flavor !== candidate.flavor ||
    comparisonRoot(root) !== comparisonRoot(candidate)
  ) {
    return false;
  }
  const rootSegments = comparisonSegments(root);
  const candidateSegments = comparisonSegments(candidate);
  return (
    rootSegments.length <= candidateSegments.length &&
    rootSegments.every((segment, index) => segment === candidateSegments[index])
  );
}

export function joinHostPath({
  rootPath,
  relativePath,
}: JoinHostPathArgs): string | null {
  const parsed = parseHostPath(rootPath);
  if (parsed === null) {
    return null;
  }
  const relativeSegments = relativePath.split(
    parsed.flavor === "windows" ? WINDOWS_SEPARATOR_PATTERN : "/",
  );
  return formatHostPath({
    ...parsed,
    segments: collapseSegments([...parsed.segments, ...relativeSegments]),
  });
}

export function getHostPathDirname(path: string): string | null {
  const parsed = parseHostPath(path);
  if (parsed === null) {
    return null;
  }
  return formatHostPath({ ...parsed, segments: parsed.segments.slice(0, -1) });
}

export function getHostPathBasename(path: string): string | null {
  const parsed = parseHostPath(path);
  if (parsed === null) {
    return null;
  }
  return parsed.segments.at(-1) ?? "";
}

export function getHostPathSegments(path: string): string[] | null {
  return parseHostPath(path)?.segments ?? null;
}

export function canonicalizeHostPath(path: string): string {
  const parsed = parseHostPath(path);
  if (parsed === null) {
    return path;
  }
  if (parsed.flavor === "windows") {
    return formatHostPath(parsed);
  }
  return path.replace(/\/+$/u, "") || "/";
}

export function getRelativeHostPath({
  rootPath,
  candidatePath,
}: IsHostPathWithinArgs): string | null {
  if (!isHostPathWithin({ rootPath, candidatePath })) {
    return null;
  }
  const rootSegments = parseHostPath(rootPath)?.segments ?? [];
  const candidateSegments = parseHostPath(candidatePath)?.segments ?? [];
  return candidateSegments.slice(rootSegments.length).join("/");
}
