import {
  buildAbsoluteFilePath,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "@bb/shared-ui/lib/absolute-file-path";
import {
  createFilePreviewLineRange,
  type FilePreviewLineRange,
} from "@bb/client-core";
import { getHostPathSegments, isAbsoluteHostPath } from "@bb/domain";
import type { WorkspaceOpenTargetId } from "@bb/host-daemon-contract";

export interface MarkdownPreviewLocalFileLink {
  lineRange: FilePreviewLineRange | null;
  openTargetId: WorkspaceOpenTargetId | null;
  path: string;
}

const EDITOR_FILE_URL_OPEN_TARGET_IDS = new Map<string, WorkspaceOpenTargetId>([
  ["cursor", "cursor"],
  ["devin", "devin-desktop"],
  ["vscode", "vscode"],
  ["vscode-insiders", "vscode-insiders"],
  ["windsurf", "devin-desktop"],
]);

export const EDITOR_FILE_URL_SCHEMES = [
  ...EDITOR_FILE_URL_OPEN_TARGET_IDS.keys(),
];

export type MarkdownPreviewLocalFileLinkHandler = (
  link: MarkdownPreviewLocalFileLink,
) => boolean;

interface MarkdownTrustedAbsoluteLocalFileLinkRouting {
  kind: "trusted-host";
}

interface MarkdownContainedAbsoluteLocalFileLinkRouting {
  kind: "contained";
  rootPath: string;
}

export type MarkdownAbsoluteLocalFileLinkRouting =
  | MarkdownTrustedAbsoluteLocalFileLinkRouting
  | MarkdownContainedAbsoluteLocalFileLinkRouting;

export interface MarkdownTouchedFiles {
  pathsBySuffix: ReadonlyMap<string, string | null>;
}

export interface MarkdownRelativeLocalFileLinkRouting {
  baseDir: string;
  rootPath: string;
  touchedFiles?: MarkdownTouchedFiles;
}

interface BuildMarkdownTouchedFilesArgs {
  paths: Iterable<string>;
  rootPath: string | null;
}

interface ResolveTouchedFilePathArgs {
  path: string;
  rootPath: string | null;
}

interface ResolveTouchedLocalFileHrefArgs {
  href: string | undefined;
  touchedFiles: MarkdownTouchedFiles;
}

interface SelectMentionedTouchedFilesArgs {
  markdown: string;
  touchedFiles: MarkdownTouchedFiles;
}

interface TouchedLocalFileLookup {
  suffix: string;
  trailer: string;
}

interface LocalFileHrefParts {
  lineRange: FilePreviewLineRange | null;
  path: string;
}

interface LocalFileUrlParts {
  openTargetId: WorkspaceOpenTargetId | null;
  path: string;
}

interface LocalFilePathValidationArgs {
  requireLikelyFileBasename: boolean;
  path: string;
}

interface ParseLineRangeArgs {
  endValue: string | undefined;
  startValue: string;
}

interface ResolveRelativeLocalFileHrefArgs {
  baseDir: string;
  href: string | undefined;
  rootPath: string;
}

interface ParseLocalFileHrefArgs {
  absoluteLinks: MarkdownAbsoluteLocalFileLinkRouting;
  href: string | undefined;
}

interface IsLinkContainedInRootArgs {
  link: MarkdownPreviewLocalFileLink;
  rootPath: string;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) {
    return null;
  }
  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
}

function parseLineRange({
  endValue,
  startValue,
}: ParseLineRangeArgs): FilePreviewLineRange | null {
  const startLineNumber = parsePositiveInteger(startValue);
  if (startLineNumber === null) {
    return null;
  }
  const endLineNumber =
    endValue === undefined ? startLineNumber : parsePositiveInteger(endValue);
  if (endLineNumber === null) {
    return null;
  }
  return createFilePreviewLineRange({
    endLineNumber,
    startLineNumber,
  });
}

function parseLineSuffix(value: string): LocalFileHrefParts | null {
  const hashLineMatch = value.match(
    /#L([0-9]+)(?:C[0-9]+)?(?:-L?([0-9]+)(?:C[0-9]+)?)?$/u,
  );
  if (hashLineMatch) {
    const lineRange = parseLineRange({
      endValue: hashLineMatch[2],
      startValue: hashLineMatch[1] ?? "",
    });
    if (lineRange === null) {
      return null;
    }

    return {
      lineRange,
      path: value.slice(0, hashLineMatch.index),
    };
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex !== -1) {
    const fragment = value.slice(hashIndex + 1);
    if (
      fragment.length === 0 ||
      fragment.includes("/") ||
      fragment.includes("#")
    ) {
      return null;
    }

    return {
      lineRange: null,
      path: value.slice(0, hashIndex),
    };
  }

  const colonLineRangeMatch = value.match(/:([0-9]+)-([0-9]+)$/u);
  if (colonLineRangeMatch) {
    const lineRange = parseLineRange({
      endValue: colonLineRangeMatch[2],
      startValue: colonLineRangeMatch[1] ?? "",
    });
    if (lineRange === null) {
      return null;
    }

    return {
      lineRange,
      path: value.slice(0, colonLineRangeMatch.index),
    };
  }

  const colonLineColumnMatch = value.match(/:([0-9]+):[0-9]+$/u);
  if (colonLineColumnMatch) {
    const lineRange = parseLineRange({
      endValue: undefined,
      startValue: colonLineColumnMatch[1] ?? "",
    });
    if (lineRange === null) {
      return null;
    }

    return {
      lineRange,
      path: value.slice(0, colonLineColumnMatch.index),
    };
  }

  const colonLineMatch = value.match(/:([0-9]+)$/u);
  if (colonLineMatch) {
    const lineRange = parseLineRange({
      endValue: undefined,
      startValue: colonLineMatch[1] ?? "",
    });
    if (lineRange === null) {
      return null;
    }

    return {
      lineRange,
      path: value.slice(0, colonLineMatch.index),
    };
  }

  return {
    lineRange: null,
    path: value,
  };
}

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const FILE_URL_WINDOWS_DRIVE_PATHNAME_PATTERN = /^\/[A-Za-z]:\//u;

export function isWindowsDriveLocalFilePath(path: string): boolean {
  return WINDOWS_DRIVE_PATH_PATTERN.test(path);
}

function isAbsoluteLocalFilePathStart(path: string): boolean {
  return (
    (path.startsWith("/") && !path.startsWith("//")) ||
    isWindowsDriveLocalFilePath(path)
  );
}

function hasLikelyFileBasename(path: string): boolean {
  const segments = isWindowsDriveLocalFilePath(path)
    ? path.split(/[\\/]/u)
    : path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  return basename.startsWith(".") || basename.includes(".");
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20) {
      return true;
    }
  }

  return false;
}

function isValidAbsoluteLocalFilePath({
  path,
  requireLikelyFileBasename,
}: LocalFilePathValidationArgs): boolean {
  return (
    isAbsoluteLocalFilePathStart(path) &&
    path !== "/" &&
    !path.endsWith("/") &&
    !(isWindowsDriveLocalFilePath(path) && path.endsWith("\\")) &&
    !path.includes("\n") &&
    !path.includes("\r") &&
    !path.includes("?") &&
    !path.includes("#") &&
    !hasControlCharacter(path) &&
    (!requireLikelyFileBasename || hasLikelyFileBasename(path))
  );
}

function parseAbsoluteLocalFileHref(
  href: string,
  requireLikelyFileBasename: boolean,
): LocalFileHrefParts | null {
  if (
    href.length === 0 ||
    href.trim() !== href ||
    !isAbsoluteLocalFilePathStart(href)
  ) {
    return null;
  }

  const parsed = parseLineSuffix(safeDecodeURIComponent(href));
  if (
    !parsed ||
    !isValidAbsoluteLocalFilePath({
      path: parsed.path,
      requireLikelyFileBasename,
    })
  ) {
    return null;
  }

  return parsed;
}

const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

const HOME_RELATIVE_PATH_PATTERN = /^~(?:[^/]*\/|$)/u;

const MARKDOWN_FILE_MENTION_PATTERN =
  /`([^`\n]+)`|\]\(\s*<([^<>\n]+)>|\]\(\s*([^\s()<>]+)/gu;

export function resolveRelativeLocalFileHref({
  baseDir,
  href,
  rootPath,
}: ResolveRelativeLocalFileHrefArgs): string | null {
  if (!href) {
    return null;
  }

  const decodedHref = safeDecodeURIComponent(href);
  const parsedHref = parseLineSuffix(decodedHref);
  if (
    href.trim() !== href ||
    decodedHref.trim() !== decodedHref ||
    parsedHref === null ||
    parsedHref.path.length === 0 ||
    parsedHref.path.startsWith("/") ||
    HOME_RELATIVE_PATH_PATTERN.test(parsedHref.path) ||
    parsedHref.path.startsWith("#") ||
    parsedHref.path.startsWith("?") ||
    URI_SCHEME_PATTERN.test(parsedHref.path)
  ) {
    return null;
  }

  const normalizedBaseDir = normalizeAbsoluteFilePath({ path: baseDir });
  const normalizedRootPath = normalizeAbsoluteFilePath({ path: rootPath });
  if (
    normalizedBaseDir === null ||
    normalizedRootPath === null ||
    !isAbsoluteFilePathWithinRoot({
      candidatePath: normalizedBaseDir,
      rootPath: normalizedRootPath,
    })
  ) {
    return null;
  }

  const joinedPath =
    normalizedBaseDir === "/"
      ? `/${parsedHref.path}`
      : `${normalizedBaseDir}/${parsedHref.path}`;
  const normalizedHrefPath = normalizeAbsoluteFilePath({ path: joinedPath });
  if (
    normalizedHrefPath === null ||
    !isAbsoluteFilePathWithinRoot({
      candidatePath: normalizedHrefPath,
      rootPath: normalizedRootPath,
    })
  ) {
    return null;
  }

  return `${normalizedHrefPath}${decodedHref.slice(parsedHref.path.length)}`;
}

export function resolveTouchedFilePath({
  path,
  rootPath,
}: ResolveTouchedFilePathArgs): string | null {
  if (path.length === 0) {
    return null;
  }
  if (isAbsoluteHostPath(path)) {
    return normalizeAbsoluteFilePath({ path });
  }
  if (rootPath === null) {
    return null;
  }
  return normalizeAbsoluteFilePath({
    path: buildAbsoluteFilePath({ path, rootPath }),
  });
}

export function buildMarkdownTouchedFiles({
  paths,
  rootPath,
}: BuildMarkdownTouchedFilesArgs): MarkdownTouchedFiles {
  const pathsBySuffix = new Map<string, string | null>();
  for (const path of paths) {
    const touchedPath = resolveTouchedFilePath({ path, rootPath });
    const segments =
      touchedPath === null ? null : getHostPathSegments(touchedPath);
    if (touchedPath === null || segments === null) {
      continue;
    }
    for (let start = segments.length - 1; start >= 0; start--) {
      const suffix = segments.slice(start).join("/");
      const knownPath = pathsBySuffix.get(suffix);
      if (knownPath === undefined) {
        pathsBySuffix.set(suffix, touchedPath);
      } else if (knownPath !== touchedPath) {
        pathsBySuffix.set(suffix, null);
      }
    }
  }
  return { pathsBySuffix };
}

function parseTouchedLocalFileLookup(
  href: string | undefined,
): TouchedLocalFileLookup | null {
  if (!href || href.trim() !== href) {
    return null;
  }

  const decodedHref = safeDecodeURIComponent(href);
  const parsedHref = parseLineSuffix(decodedHref);
  if (
    parsedHref === null ||
    parsedHref.path.startsWith("/") ||
    isWindowsDriveLocalFilePath(parsedHref.path) ||
    HOME_RELATIVE_PATH_PATTERN.test(parsedHref.path) ||
    URI_SCHEME_PATTERN.test(parsedHref.path)
  ) {
    return null;
  }

  const segments = parsedHref.path.split("/");
  while (segments[0] === ".") {
    segments.shift();
  }
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return {
    suffix: segments.join("/"),
    trailer: decodedHref.slice(parsedHref.path.length),
  };
}

export function resolveTouchedLocalFileHref({
  href,
  touchedFiles,
}: ResolveTouchedLocalFileHrefArgs): string | null {
  const lookup = parseTouchedLocalFileLookup(href);
  const touchedPath =
    lookup === null ? undefined : touchedFiles.pathsBySuffix.get(lookup.suffix);
  return lookup !== null && typeof touchedPath === "string"
    ? `${touchedPath}${lookup.trailer}`
    : null;
}

export function selectMentionedTouchedFiles({
  markdown,
  touchedFiles,
}: SelectMentionedTouchedFilesArgs): [string, string][] {
  const selected = new Map<string, string>();
  for (const match of markdown.matchAll(MARKDOWN_FILE_MENTION_PATTERN)) {
    const lookup = parseTouchedLocalFileLookup(
      match[1] ?? match[2] ?? match[3],
    );
    const touchedPath =
      lookup === null
        ? undefined
        : touchedFiles.pathsBySuffix.get(lookup.suffix);
    if (lookup !== null && typeof touchedPath === "string") {
      selected.set(lookup.suffix, touchedPath);
    }
  }
  return [...selected].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function isLinkContainedInRoot({
  link,
  rootPath,
}: IsLinkContainedInRootArgs): MarkdownPreviewLocalFileLink | null {
  const normalizedPath = normalizeAbsoluteFilePath({ path: link.path });
  if (normalizedPath === null) {
    return null;
  }

  if (
    !isAbsoluteFilePathWithinRoot({
      candidatePath: normalizedPath,
      rootPath,
    })
  ) {
    return null;
  }

  return {
    ...link,
    path: normalizedPath,
  };
}

function parseLocalFileUrl(href: string): LocalFileUrlParts | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.search.length > 0) {
    return null;
  }
  const pathname = FILE_URL_WINDOWS_DRIVE_PATHNAME_PATTERN.test(url.pathname)
    ? url.pathname.slice(1)
    : url.pathname;
  if (url.protocol === "file:") {
    return url.host.length > 0
      ? null
      : { openTargetId: null, path: pathname + url.hash };
  }
  const openTargetId = EDITOR_FILE_URL_OPEN_TARGET_IDS.get(
    url.protocol.slice(0, -1),
  );
  if (
    openTargetId === undefined ||
    url.host !== "file" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    return null;
  }
  return { openTargetId, path: pathname };
}

export function parseLocalFileHref({
  absoluteLinks,
  href,
}: ParseLocalFileHrefArgs): MarkdownPreviewLocalFileLink | null {
  if (!href) {
    return null;
  }

  const isUrl =
    URI_SCHEME_PATTERN.test(href) && !isWindowsDriveLocalFilePath(href);
  const urlParts = isUrl ? parseLocalFileUrl(href) : null;
  if (isUrl && urlParts === null) {
    return null;
  }
  const parts = parseAbsoluteLocalFileHref(
    urlParts?.path ?? href,
    absoluteLinks.kind === "trusted-host" && !isUrl,
  );
  const link =
    parts === null
      ? null
      : { ...parts, openTargetId: urlParts?.openTargetId ?? null };

  if (link === null || absoluteLinks.kind === "trusted-host") {
    return link;
  }

  return isLinkContainedInRoot({
    link,
    rootPath: absoluteLinks.rootPath,
  });
}

function encodeFileUrlPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function buildLineRangeAnchorFragment(
  lineRange: FilePreviewLineRange | null,
): string {
  if (lineRange === null) {
    return "";
  }
  if (lineRange.startLineNumber === lineRange.endLineNumber) {
    return `#L${lineRange.startLineNumber}`;
  }
  return `#L${lineRange.startLineNumber}-L${lineRange.endLineNumber}`;
}

export function buildLocalFileAnchorHref(
  link: MarkdownPreviewLocalFileLink | null,
  originalHref: string | undefined,
): string | undefined {
  if (link && isWindowsDriveLocalFilePath(link.path)) {
    const [drive = "", ...segments] = link.path.split(/[\\/]+/u);
    return `file:///${drive}/${segments
      .map(encodeURIComponent)
      .join("/")}${buildLineRangeAnchorFragment(link.lineRange)}`;
  }
  if (!link || !link.path.startsWith("/")) {
    return originalHref;
  }

  return `file://${encodeFileUrlPath(link.path)}${buildLineRangeAnchorFragment(
    link.lineRange,
  )}`;
}
