import { ok } from "./result.js";
import type { ToolResult } from "./types.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const SOFT_RESPONSE_BYTES = 4 * 1024;

export interface PageRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ResolvedPage {
  readonly limit: number;
  readonly offset: number;
}

export function normalizePageSize(limit?: number): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Page limit must be a positive integer.");
  }
  return Math.min(limit, MAX_PAGE_SIZE);
}

export function encodeCursor(offset: number): string {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Cursor offset must be a non-negative safe integer.");
  }
  return Buffer.from(`fs-page-v1:${offset}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor?: string): number {
  if (cursor === undefined) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^fs-page-v1:(0|[1-9]\d*)$/u.exec(decoded);
  const offset = match ? Number(match[1]) : Number.NaN;
  if (
    !match ||
    !Number.isSafeInteger(offset) ||
    encodeCursor(offset) !== cursor
  ) {
    throw new RangeError("Cursor is invalid; restart the query without a cursor.");
  }
  return offset;
}

export function resolvePage(request: PageRequest = {}): ResolvedPage {
  return {
    limit: normalizePageSize(request.limit),
    offset: decodeCursor(request.cursor),
  };
}

interface OptionalSummary {
  readonly owner: object;
  readonly key: string;
  readonly bytes: number;
}

// Only string fields named `summary` are optional budget material. Handlers
// must use that key for discardable prose; other fields are always preserved.
function optionalSummaries(value: unknown): OptionalSummary[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(optionalSummaries);

  const summaries: OptionalSummary[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (key === "summary" && typeof nested === "string") {
      summaries.push({
        owner: value,
        key,
        bytes: Buffer.byteLength(nested, "utf8"),
      });
    } else {
      summaries.push(...optionalSummaries(nested));
    }
  }
  return summaries;
}

export function enforceBudget<T>(
  result: ToolResult<T>,
  softBytes = SOFT_RESPONSE_BYTES,
): ToolResult<T> {
  if (!Number.isSafeInteger(softBytes) || softBytes < 1) {
    throw new RangeError("Soft response budget must be a positive integer.");
  }
  if (!result.ok) return result;

  const options = {
    ...(result.meta.truncated ? { truncated: true } : {}),
    ...(result.meta.nextCursor
      ? { nextCursor: result.meta.nextCursor }
      : {}),
  };
  let measured = ok(result.data, options);
  if (measured.meta.bytes <= softBytes) return measured;

  const data = structuredClone(result.data);
  const summaries = optionalSummaries(data).sort(
    (left, right) => right.bytes - left.bytes,
  );
  let truncated = false;
  for (const summary of summaries) {
    Reflect.deleteProperty(summary.owner, summary.key);
    truncated = true;
    measured = ok(data, { ...options, truncated: true });
    if (measured.meta.bytes <= softBytes) return measured;
  }

  return truncated ? measured : ok(data, options);
}
