import type {
  ExperimentalFileLocation,
  ExperimentalFileOpenOptions,
  ExperimentalLiveFileTarget,
} from "../app-contract.js";
import type { JsonValue } from "../json-value.js";
import { z } from "zod";

type JsonObject = { [key: string]: JsonValue };

const jsonObjectSchema = z.record(z.string(), z.json());
const stringSchema = z.string();
const positiveSafeIntegerSchema = z
  .number()
  .refine((value) => Number.isSafeInteger(value) && value > 0);

const FILE_PATH_MAX_LENGTH = 32_768;
const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_ABSOLUTE_PATH = /^\\\\/u;

function isJsonObject<Value>(value: Value): value is Value & JsonObject {
  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) return false;
  const prototype = Object.getPrototypeOf(parsed.data);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isNonEmptyIdentity(value: JsonValue): value is string {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success) return false;
  return (
    parsed.data.length > 0 &&
    parsed.data.length <= FILE_PATH_MAX_LENGTH &&
    parsed.data.trim() === parsed.data
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20) return true;
  }
  return false;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isValidPathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== "..";
}

function isPositiveSafeInteger(value: JsonValue): value is number {
  return positiveSafeIntegerSchema.safeParse(value).success;
}

function isValidRelativeFilePath(value: JsonValue): value is string {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success) return false;
  if (
    parsed.data.length === 0 ||
    parsed.data.length > FILE_PATH_MAX_LENGTH ||
    parsed.data.trim() !== parsed.data ||
    parsed.data.includes("\\") ||
    hasControlCharacter(parsed.data) ||
    hasUnpairedSurrogate(parsed.data)
  ) {
    return false;
  }
  return parsed.data.split("/").every(isValidPathSegment);
}

function isValidAbsoluteHostFilePath(value: JsonValue): value is string {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success) return false;
  if (
    parsed.data.length === 0 ||
    parsed.data.length > FILE_PATH_MAX_LENGTH ||
    parsed.data.trim() !== parsed.data ||
    hasControlCharacter(parsed.data) ||
    hasUnpairedSurrogate(parsed.data)
  ) {
    return false;
  }

  if (parsed.data.startsWith("/") && !parsed.data.startsWith("//")) {
    const segments = parsed.data.slice(1).split("/");
    return segments.length > 0 && segments.every(isValidPathSegment);
  }

  if (WINDOWS_DRIVE_ABSOLUTE_PATH.test(parsed.data)) {
    const segments = parsed.data.slice(3).split(/[\\/]/u);
    return segments.length > 0 && segments.every(isValidPathSegment);
  }

  if (WINDOWS_UNC_ABSOLUTE_PATH.test(parsed.data)) {
    const segments = parsed.data.slice(2).split(/[\\/]/u);
    return segments.length >= 3 && segments.every(isValidPathSegment);
  }

  return false;
}

export function normalizeExperimentalLiveFileTarget<Value>(
  value: Value,
): ExperimentalLiveFileTarget | null {
  if (!isJsonObject(value)) return null;
  const kind = stringSchema.safeParse(value.kind);
  if (!kind.success) return null;

  switch (kind.data) {
    case "workspace":
      if (
        !hasExactKeys(value, ["kind", "environmentId", "path"]) ||
        !isNonEmptyIdentity(value.environmentId) ||
        !isValidRelativeFilePath(value.path)
      ) {
        return null;
      }
      return {
        kind: "workspace",
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
      return { kind: "host", hostId: value.hostId, path: value.path };
    case "thread-storage":
      if (
        !hasExactKeys(value, ["kind", "threadId", "path"]) ||
        !isNonEmptyIdentity(value.threadId) ||
        !isValidRelativeFilePath(value.path)
      ) {
        return null;
      }
      return {
        kind: "thread-storage",
        threadId: value.threadId,
        path: value.path,
      };
    default:
      return null;
  }
}

export function normalizeExperimentalFileLocation<Value>(
  value: Value,
): ExperimentalFileLocation | null | undefined {
  if (value === null) return null;
  if (!isJsonObject(value)) return undefined;
  const kind = stringSchema.safeParse(value.kind);
  if (!kind.success) return undefined;

  switch (kind.data) {
    case "line":
      if (
        !hasExactKeys(value, ["kind", "line", "column"]) ||
        !isPositiveSafeInteger(value.line) ||
        (value.column !== null && !isPositiveSafeInteger(value.column))
      ) {
        return undefined;
      }
      return {
        kind: "line",
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
        kind: "range",
        startLine: value.startLine,
        endLine: value.endLine,
      };
    default:
      return undefined;
  }
}

export function normalizeExperimentalFileOpenOptions<Value>(
  value: Value,
): ExperimentalFileOpenOptions | null {
  if (!isJsonObject(value) || !hasExactKeys(value, ["target", "location"])) {
    return null;
  }
  const target = normalizeExperimentalLiveFileTarget(value.target);
  const location = normalizeExperimentalFileLocation(value.location);
  if (target === null || location === undefined) return null;
  return { target, location };
}
