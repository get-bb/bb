import {
  buildAbsoluteFilePath,
  isAbsoluteFilePath,
  isAbsoluteFilePathWithinRoot,
  isWindowsAbsoluteFilePath,
  normalizeAbsoluteFilePath,
} from "@/lib/absolute-file-path";
import {
  createFilePreviewLineRange,
  type FilePreviewLineRange,
} from "@bb/client-core";

export interface MarkdownPreviewLocalFileLink {
  lineRange: FilePreviewLineRange | null;
  path: string;
}

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

export interface MarkdownRelativeLocalFileLinkRouting {
  baseDir: string;
  rootPath: string;
}

interface LocalFileHrefParts {
  lineRange: FilePreviewLineRange | null;
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

interface ResolveRelativeLocalFileHrefArgs extends MarkdownRelativeLocalFileLinkRouting {
  href: string | undefined;
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

function hasLikelyFileBasename(path: string): boolean {
  const segments = path.split(/[/\\]/u);
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
  if (isWindowsAbsoluteFilePath(path)) {
    return (
      !path.endsWith("/") &&
      !path.endsWith("\\") &&
      !path.includes("\n") &&
      !path.includes("\r") &&
      !path.includes("?") &&
      !path.includes("#") &&
      !hasControlCharacter(path) &&
      (!requireLikelyFileBasename || hasLikelyFileBasename(path))
    );
  }
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    path !== "/" &&
    !path.endsWith("/") &&
    !path.includes("\n") &&
    !path.includes("\r") &&
    !path.includes("?") &&
    !path.includes("#") &&
    !hasControlCharacter(path) &&
    (!requireLikelyFileBasename || hasLikelyFileBasename(path))
  );
}

const WINDOWS_DRIVE_FILE_URL_PATH_PATTERN = /^\/[A-Za-z]:(?:\/|$)/u;

function parseAbsoluteLocalFileHref(
  href: string,
  requireLikelyFileBasename: boolean,
): MarkdownPreviewLocalFileLink | null {
  if (
    href.length === 0 ||
    href.trim() !== href ||
    !isAbsoluteFilePath(href) ||
    href.startsWith("//")
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
    isAbsoluteFilePath(parsedHref.path) ||
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

  const joinedPath = buildAbsoluteFilePath({
    path: parsedHref.path,
    rootPath: normalizedBaseDir,
  });
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

export function parseLocalFileHref({
  absoluteLinks,
  href,
}: ParseLocalFileHrefArgs): MarkdownPreviewLocalFileLink | null {
  if (!href) {
    return null;
  }

  const requireLikelyFileBasename =
    absoluteLinks.kind === "trusted-host" && !href.startsWith("file://");
  let link: MarkdownPreviewLocalFileLink | null;
  if (href.startsWith("file://")) {
    try {
      const url = new URL(href);
      if (url.host.length > 0) {
        return null;
      }
      if (url.search.length > 0) {
        return null;
      }
      const filePath = WINDOWS_DRIVE_FILE_URL_PATH_PATTERN.test(url.pathname)
        ? url.pathname.slice(1) + url.hash
        : url.pathname + url.hash;
      link = parseAbsoluteLocalFileHref(
        filePath,
        requireLikelyFileBasename,
      );
    } catch {
      return null;
    }
  } else {
    link = parseAbsoluteLocalFileHref(href, requireLikelyFileBasename);
  }

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

const WINDOWS_DRIVE_PATH_PATTERN = /^([A-Za-z]:)([\\/].*)?$/u;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\([^\\/]+)[\\/]+([^\\/]+)([\\/].*)?$/u;
const WINDOWS_EXTENDED_PREFIX_PATTERN = /^\\\\[?.]\\/u;

function buildAbsoluteFileUrl(path: string): string | null {
  if (path.startsWith("/") && !path.startsWith("//")) {
    return `file://${encodeFileUrlPath(path)}`;
  }
  if (
    !isWindowsAbsoluteFilePath(path) ||
    WINDOWS_EXTENDED_PREFIX_PATTERN.test(path)
  ) {
    return null;
  }
  const driveMatch = WINDOWS_DRIVE_PATH_PATTERN.exec(path);
  if (driveMatch) {
    const drive = driveMatch[1] ?? "";
    const rest = (driveMatch[2] ?? "/").replace(/\\/gu, "/");
    const encodedRest = rest.split("/").map(encodeURIComponent).join("/");
    return `file:///${drive}${encodedRest}`;
  }
  const uncMatch = WINDOWS_UNC_PATH_PATTERN.exec(path);
  if (uncMatch) {
    const server = uncMatch[1] ?? "";
    const share = uncMatch[2] ?? "";
    const rest = (uncMatch[3] ?? "").replace(/\\/gu, "/");
    const encodedRest = rest.split("/").map(encodeURIComponent).join("/");
    return `file://${server}/${encodeURIComponent(share)}${encodedRest}`;
  }
  return null;
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
  if (!link) {
    return originalHref;
  }
  const fileUrl = buildAbsoluteFileUrl(link.path);
  if (fileUrl === null) {
    return originalHref;
  }
  return `${fileUrl}${buildLineRangeAnchorFragment(link.lineRange)}`;
}
