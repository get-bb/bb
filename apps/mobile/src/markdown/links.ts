import {
  createFilePreviewLineRange,
  rewriteLocalhostLinkHref,
  type FilePreviewLineRange,
} from "@bb/client-core";

/**
 * Link classification for markdown anchors. Adapted from the web's
 * `markdown-local-file-link.ts` (trusted-host absolute links: the timeline
 * renders agent output from the workspace host, so any absolute path with a
 * file-looking basename is a local file link) plus the localhost rewrite
 * preference from `@bb/client-core`.
 */

export interface MarkdownLocalFileLink {
  kind: "local-file";
  /** Absolute path on the workspace host. */
  path: string;
  lineRange: FilePreviewLineRange | null;
  /** The href as authored (after localhost rewriting). */
  href: string;
}

export interface MarkdownExternalLink {
  kind: "external";
  /**
   * Absolute URL (after localhost rewriting) on the safe-scheme allow-list,
   * ready for `Linking.openURL`.
   */
  url: string;
  href: string;
}

/** In-document fragments, relative paths, and anything else: inert. */
export interface MarkdownRelativeLink {
  kind: "relative";
  href: string;
}

/**
 * A URL whose scheme is not on the allow-list (`tel:`, `sms:`, `javascript:`,
 * `shortcuts://`, the app's own `bb://` deep links, other apps' custom
 * schemes, …). Never handed to `Linking.openURL`; the web blanks these via
 * react-markdown's `defaultUrlTransform`.
 */
export interface MarkdownBlockedLink {
  kind: "blocked";
  href: string;
}

export type MarkdownLinkTarget =
  | MarkdownLocalFileLink
  | MarkdownExternalLink
  | MarkdownRelativeLink
  | MarkdownBlockedLink;

export interface ClassifyMarkdownLinkOptions {
  /** `bb.rewriteLocalhostLinks` preference (default on in the web app). */
  rewriteLocalhostLinks: boolean;
  /** Hostname the client reached the bb server on (for the rewrite). */
  serverHostname: string | undefined;
}

interface LocalFileHrefParts {
  lineRange: FilePreviewLineRange | null;
  path: string;
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

function parseLineRange(
  startValue: string,
  endValue: string | undefined,
): FilePreviewLineRange | null {
  const startLineNumber = parsePositiveInteger(startValue);
  if (startLineNumber === null) {
    return null;
  }
  const endLineNumber =
    endValue === undefined ? startLineNumber : parsePositiveInteger(endValue);
  if (endLineNumber === null) {
    return null;
  }
  return createFilePreviewLineRange({ endLineNumber, startLineNumber });
}

/**
 * Splits `path#L10-L20`, `path#L5`, `path:10-20`, `path:10:4`, `path:10` and
 * `path#fragment` into path + optional line range (same grammar as the web).
 */
export function parseLocalFileLineSuffix(
  value: string,
): LocalFileHrefParts | null {
  const hashLineMatch = value.match(
    /#L([0-9]+)(?:C[0-9]+)?(?:-L?([0-9]+)(?:C[0-9]+)?)?$/u,
  );
  if (hashLineMatch) {
    const lineRange = parseLineRange(hashLineMatch[1] ?? "", hashLineMatch[2]);
    if (lineRange === null) {
      return null;
    }
    return { lineRange, path: value.slice(0, hashLineMatch.index) };
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
    return { lineRange: null, path: value.slice(0, hashIndex) };
  }

  const colonLineRangeMatch = value.match(/:([0-9]+)-([0-9]+)$/u);
  if (colonLineRangeMatch) {
    const lineRange = parseLineRange(
      colonLineRangeMatch[1] ?? "",
      colonLineRangeMatch[2],
    );
    if (lineRange === null) {
      return null;
    }
    return { lineRange, path: value.slice(0, colonLineRangeMatch.index) };
  }

  const colonLineColumnMatch = value.match(/:([0-9]+):[0-9]+$/u);
  if (colonLineColumnMatch) {
    const lineRange = parseLineRange(colonLineColumnMatch[1] ?? "", undefined);
    if (lineRange === null) {
      return null;
    }
    return { lineRange, path: value.slice(0, colonLineColumnMatch.index) };
  }

  const colonLineMatch = value.match(/:([0-9]+)$/u);
  if (colonLineMatch) {
    const lineRange = parseLineRange(colonLineMatch[1] ?? "", undefined);
    if (lineRange === null) {
      return null;
    }
    return { lineRange, path: value.slice(0, colonLineMatch.index) };
  }

  return { lineRange: null, path: value };
}

function hasLikelyFileBasename(path: string): boolean {
  const segments = path.split("/");
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

function isValidAbsoluteLocalFilePath(
  path: string,
  requireLikelyFileBasename: boolean,
): boolean {
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

function parseAbsoluteLocalFileHref(
  href: string,
  requireLikelyFileBasename: boolean,
): LocalFileHrefParts | null {
  if (
    href.length === 0 ||
    href.trim() !== href ||
    !href.startsWith("/") ||
    href.startsWith("//")
  ) {
    return null;
  }
  const parsed = parseLocalFileLineSuffix(safeDecodeURIComponent(href));
  if (
    parsed === null ||
    !isValidAbsoluteLocalFilePath(parsed.path, requireLikelyFileBasename)
  ) {
    return null;
  }
  return parsed;
}

/**
 * Parses an absolute local file href under trusted-host rules: `file:///…`
 * always, bare `/abs/path[:line]` only when the basename looks like a file
 * (so `/settings` or `/api/v1` stay ordinary links).
 */
export function parseLocalFileHref(
  href: string | undefined,
): Omit<MarkdownLocalFileLink, "kind" | "href"> | null {
  if (!href) {
    return null;
  }
  if (href.startsWith("file://")) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.host.length > 0 || url.search.length > 0) {
      return null;
    }
    return parseAbsoluteLocalFileHref(url.pathname + url.hash, false);
  }
  return parseAbsoluteLocalFileHref(href, true);
}

const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

/**
 * Schemes a tap may open outside the app. Same allow-list as react-markdown's
 * `defaultUrlTransform` (`safeProtocol`), which the web's markdown preview
 * falls back to; everything else is model-authored input that must not reach
 * `Linking.openURL`.
 */
const SAFE_EXTERNAL_SCHEME_PATTERN = /^(?:https?|ircs?|mailto|xmpp):/iu;

/**
 * Decide what tapping a markdown link should do. Local file links win over
 * scheme detection so `Cargo.lock:14` style references keep working; a URL
 * with an allow-listed scheme is external; a URL with any other scheme is
 * blocked; the rest (fragments, relative paths) are inert.
 */
export function classifyMarkdownLink(
  href: string,
  options: ClassifyMarkdownLinkOptions,
): MarkdownLinkTarget {
  const rewritten =
    rewriteLocalhostLinkHref({
      currentHostname: options.serverHostname,
      enabled: options.rewriteLocalhostLinks,
      href,
    }) ?? href;
  const localFile = parseLocalFileHref(rewritten);
  if (localFile !== null) {
    return { kind: "local-file", href: rewritten, ...localFile };
  }
  // Strip a line suffix before scheme detection so `Cargo.lock:14:33` stays a
  // relative file reference; `http://host:8080` keeps its scheme because the
  // remaining path part still carries one.
  const schemeProbe = parseLocalFileLineSuffix(rewritten)?.path ?? rewritten;
  if (URI_SCHEME_PATTERN.test(schemeProbe)) {
    return SAFE_EXTERNAL_SCHEME_PATTERN.test(schemeProbe)
      ? { kind: "external", href: rewritten, url: rewritten }
      : { kind: "blocked", href: rewritten };
  }
  return { kind: "relative", href: rewritten };
}

/**
 * The inline-code affordance from the web: a code span whose whole value is
 * an absolute `.md` path opens that file. Returns the href or null.
 */
export function resolveInlineCodeMarkdownFileHref(
  codeText: string,
): string | null {
  if (
    codeText.length === 0 ||
    codeText.trim() !== codeText ||
    codeText.includes("\n") ||
    codeText.includes("\r")
  ) {
    return null;
  }
  const link = parseLocalFileHref(codeText);
  if (link === null) {
    return null;
  }
  return /\.(?:md|markdown)$/iu.test(link.path) ? codeText : null;
}
