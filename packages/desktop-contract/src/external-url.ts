export const EDITOR_FILE_URL_SCHEMES = [
  "cursor",
  "devin",
  "vscode",
  "vscode-insiders",
  "windsurf",
] as const;

const EDITOR_FILE_URL_PROTOCOLS = new Set<string>(
  EDITOR_FILE_URL_SCHEMES.map((scheme) => `${scheme}:`),
);
const WEB_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const EDITOR_FILE_URL_PREFIX_PATTERN = /^[a-z-]+:\/\/file(?=\/)/iu;
const UNSAFE_EDITOR_URL_PATTERN = /[\s\\?#]/u;
const UNSAFE_EDITOR_PATH_PATTERN = /[\\\u0000-\u001f\u007f-\u009f]/u;
const LINE_COLUMN_SUFFIX_PATTERN = /(?::\d+){1,2}$/u;
const DOT_SEGMENT_PATTERN = /^[. ]*$/u;
const WINDOWS_DRIVE_PATH_PATTERN = /^\/[a-z]:\//iu;
const WORKSPACE_FILE_PATTERN = /\.code-workspace[. ]*$/iu;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function decodePath(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

function isOrdinaryPathSegment(segment: string): boolean {
  return !DOT_SEGMENT_PATTERN.test(segment);
}

function parseEditorFilePath(value: string): string | null {
  const prefix = EDITOR_FILE_URL_PREFIX_PATTERN.exec(value)?.[0];
  if (prefix === undefined || UNSAFE_EDITOR_URL_PATTERN.test(value)) {
    return null;
  }
  const decoded = decodePath(value.slice(prefix.length));
  if (decoded === null || UNSAFE_EDITOR_PATH_PATTERN.test(decoded)) {
    return null;
  }
  const path = decoded.replace(LINE_COLUMN_SUFFIX_PATTERN, "");
  if (
    path.split(":").some((piece) => !Number.isNaN(Number(piece))) ||
    !path.slice(1).split("/").every(isOrdinaryPathSegment) ||
    WORKSPACE_FILE_PATTERN.test(path)
  ) {
    return null;
  }
  return WINDOWS_DRIVE_PATH_PATTERN.test(path) ? path.slice(1) : path;
}

export function resolveEditorFilePath(value: string): string | null {
  return resolveEditorFileUrl(value) === null
    ? null
    : parseEditorFilePath(value);
}

export function resolveEditorFileUrl(value: string): string | null {
  if (parseEditorFilePath(value) === null) {
    return null;
  }
  const url = parseUrl(value);
  if (
    url === null ||
    !EDITOR_FILE_URL_PROTOCOLS.has(url.protocol) ||
    url.host !== "file" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  return url.href;
}

export function resolveDesktopExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    return null;
  }
  const url = parseUrl(value);
  if (url === null) {
    return null;
  }
  if (WEB_URL_PROTOCOLS.has(url.protocol)) {
    return url.href;
  }
  return resolveEditorFileUrl(value);
}
