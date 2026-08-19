import type {
  ExperimentalFileLocation,
  ExperimentalFileOpenOptions,
  ExperimentalLiveFileTarget,
} from "@get-bb/plugin-sdk";
import type { FilePreviewLineRange } from "@/lib/file-preview";

const FILE_PATH_MAX_LENGTH = 32_768;
const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_ABSOLUTE_PATH = /^\\\\/u;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isNonEmptyIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= FILE_PATH_MAX_LENGTH &&
    value.trim() === value
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20) return true;
  }
  return false;
}

function isValidPathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== "..";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isValidRelativeFilePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FILE_PATH_MAX_LENGTH ||
    value.trim() !== value ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    return false;
  }
  return value.split("/").every(isValidPathSegment);
}

function isValidAbsoluteHostFilePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FILE_PATH_MAX_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    return false;
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    const segments = value.slice(1).split("/");
    return segments.length > 0 && segments.every(isValidPathSegment);
  }

  if (WINDOWS_DRIVE_ABSOLUTE_PATH.test(value)) {
    const segments = value.slice(3).split(/[\\/]/u);
    return segments.length > 0 && segments.every(isValidPathSegment);
  }

  if (WINDOWS_UNC_ABSOLUTE_PATH.test(value)) {
    const segments = value.slice(2).split(/[\\/]/u);
    return segments.length >= 3 && segments.every(isValidPathSegment);
  }

  return false;
}

export function normalizeExperimentalLiveFileTarget(
  value: unknown,
): ExperimentalLiveFileTarget | null {
  if (!isJsonObject(value) || typeof value.kind !== "string") return null;

  switch (value.kind) {
    case "workspace":
      if (
        !hasExactKeys(value, ["kind", "environmentId", "path"]) ||
        !isNonEmptyIdentity(value.environmentId) ||
        !isValidRelativeFilePath(value.path)
      ) {
        return null;
      }
      return {
        kind: value.kind,
        environmentId: value.environmentId,
        path: value.path,
      };
    case "host":
      if (
        !hasExactKeys(value, ["kind", "hostId", "path"]) ||
        !isNonEmptyIdentity(value.hostId) ||
        !isValidAbsoluteHostFilePath(value.path)
      ) {
        return null;
      }
      return { kind: value.kind, hostId: value.hostId, path: value.path };
    case "thread-storage":
      if (
        !hasExactKeys(value, ["kind", "threadId", "path"]) ||
        !isNonEmptyIdentity(value.threadId) ||
        !isValidRelativeFilePath(value.path)
      ) {
        return null;
      }
      return { kind: value.kind, threadId: value.threadId, path: value.path };
    default:
      return null;
  }
}

export function normalizeExperimentalFileLocation(
  value: unknown,
): ExperimentalFileLocation | null | undefined {
  if (value === null) return null;
  if (!isJsonObject(value) || typeof value.kind !== "string") return undefined;

  switch (value.kind) {
    case "line":
      if (
        !hasExactKeys(value, ["kind", "line", "column"]) ||
        !isPositiveSafeInteger(value.line) ||
        (value.column !== null && !isPositiveSafeInteger(value.column))
      ) {
        return undefined;
      }
      return {
        kind: value.kind,
        line: value.line,
        column: value.column,
      };
    case "range":
      if (
        !hasExactKeys(value, ["kind", "startLine", "endLine"]) ||
        !isPositiveSafeInteger(value.startLine) ||
        !isPositiveSafeInteger(value.endLine) ||
        value.endLine < value.startLine
      ) {
        return undefined;
      }
      return {
        kind: value.kind,
        startLine: value.startLine,
        endLine: value.endLine,
      };
    default:
      return undefined;
  }
}

export function normalizeExperimentalFileOpenOptions(
  value: unknown,
): ExperimentalFileOpenOptions | null {
  if (!isJsonObject(value) || !hasExactKeys(value, ["target", "location"])) {
    return null;
  }
  const target = normalizeExperimentalLiveFileTarget(value.target);
  const location = normalizeExperimentalFileLocation(value.location);
  if (target === null || location === undefined) return null;
  return { target, location };
}

export function getExperimentalFileLocationStart(
  location: ExperimentalFileLocation | null,
): { columnNumber: number | null; lineNumber: number | null } {
  if (location === null) return { columnNumber: null, lineNumber: null };
  if (location.kind === "line") {
    return { columnNumber: location.column, lineNumber: location.line };
  }
  return { columnNumber: null, lineNumber: location.startLine };
}

export function toFilePreviewLineRange(
  location: ExperimentalFileLocation | null,
): FilePreviewLineRange | null {
  if (location === null) return null;
  return {
    startLineNumber:
      location.kind === "line" ? location.line : location.startLine,
    endLineNumber: location.kind === "line" ? location.line : location.endLine,
  };
}
