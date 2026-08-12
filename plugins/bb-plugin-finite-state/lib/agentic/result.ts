import { inspect } from "node:util";
import type {
  FieldDiff,
  ToolError,
  ToolResult,
  ToolSuccess,
  WriteOperation,
  WriteResult,
} from "./types.js";

const MAX_DIFF_FIELDS = 20;
const MAX_DIFF_VALUE_BYTES = 160;
const RELATIVE_PATH_SEGMENT = /^(?!\.\.?$)[^/\\\u0000]+$/u;

export interface ToolResultOptions {
  readonly truncated?: boolean;
  readonly nextCursor?: string;
}

export interface ToolErrorLogger {
  error(message: string): void;
}

export class KnownToolError extends Error implements ToolError {
  readonly code: string;
  readonly hint: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(error: ToolError) {
    super(error.message);
    this.name = "KnownToolError";
    this.code = error.code;
    this.hint = error.hint;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

export function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Tool results must be JSON-serializable values.");
  }
  return Buffer.byteLength(serialized, "utf8");
}

export function ok<T>(data: T, options: ToolResultOptions = {}): ToolSuccess<T> {
  const optionalMeta = {
    ...(options.truncated ? { truncated: true } : {}),
    ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
  };
  let bytes = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const measured = serializedBytes({
      ok: true,
      data,
      meta: { bytes, ...optionalMeta },
    });
    if (measured === bytes) break;
    bytes = measured;
  }
  return { ok: true, data, meta: { bytes, ...optionalMeta } };
}

export function fail(
  code: string,
  message: string,
  hint: string,
  retryable = false,
  details?: unknown,
): ToolResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      hint,
      retryable,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function fromException(
  cause: unknown,
  logger: ToolErrorLogger,
): ToolResult<never> {
  if (cause instanceof KnownToolError) {
    return fail(
      cause.code,
      cause.message,
      cause.hint,
      cause.retryable,
      cause.details,
    );
  }

  logger.error(`Unhandled agent tool error: ${inspect(cause)}`);
  return fail(
    "internal_error",
    "The tool could not complete because of an internal error.",
    "Retry once. If the error repeats, inspect `bb plugin logs finite-state` and report the tool name and time.",
    true,
  );
}

export async function executeSafely<T>(
  execute: () => ToolResult<T> | Promise<ToolResult<T>>,
  logger: ToolErrorLogger,
): Promise<ToolResult<T>> {
  try {
    return await execute();
  } catch (cause) {
    return fromException(cause, logger);
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let output = "";
  for (const character of value) {
    if (Buffer.byteLength(`${output}${character}`, "utf8") > maxBytes) break;
    output += character;
  }
  return output;
}

function validateRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/u.test(path) ||
    path.split("/").some((segment) => !RELATIVE_PATH_SEGMENT.test(segment))
  ) {
    throw new TypeError("Write results require a worktree-relative path.");
  }
}

export function writeResult(
  path: string,
  op: WriteOperation,
  diffs: readonly FieldDiff[],
): WriteResult {
  validateRelativePath(path);
  const included = diffs.slice(0, MAX_DIFF_FIELDS).map((diff) => ({
    field: truncateUtf8(diff.field, MAX_DIFF_VALUE_BYTES),
    from:
      diff.from === null
        ? null
        : truncateUtf8(diff.from, MAX_DIFF_VALUE_BYTES),
    to:
      diff.to === null ? null : truncateUtf8(diff.to, MAX_DIFF_VALUE_BYTES),
  }));
  return {
    path,
    op,
    diffSummary: included,
    omittedDiffs: diffs.length - included.length,
  };
}
