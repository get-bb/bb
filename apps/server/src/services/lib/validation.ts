import {
  LIST_PAGE_DEFAULT_LIMIT,
  LIST_PAGE_MAX_LIMIT,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export function parseInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, "invalid_request", `Invalid integer for ${name}`);
  }
  return parsed;
}

export function parseOptionalInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  return value === undefined ? undefined : parseInteger(value, name);
}

export function parsePaginationQuery(args: {
  limit: string | undefined;
  offset: string | undefined;
}): { limit: number; offset: number } {
  const limit =
    parseOptionalInteger(args.limit, "limit") ?? LIST_PAGE_DEFAULT_LIMIT;
  if (limit <= 0) {
    throw new ApiError(400, "invalid_request", "limit must be positive");
  }
  if (limit > LIST_PAGE_MAX_LIMIT) {
    throw new ApiError(
      400,
      "invalid_request",
      `limit cannot exceed ${LIST_PAGE_MAX_LIMIT}; page with offset`,
    );
  }
  const offset = parseOptionalInteger(args.offset, "offset") ?? 0;
  if (offset < 0) {
    throw new ApiError(400, "invalid_request", "offset must be non-negative");
  }
  return { limit, offset };
}

interface ParseBoundedPositiveOptionalIntegerArgs {
  defaultValue: number;
  max: number;
  name: string;
  value: string | undefined;
}

export function parseBoundedPositiveOptionalInteger(
  args: ParseBoundedPositiveOptionalIntegerArgs,
): number {
  const parsed = Math.min(
    parseOptionalInteger(args.value, args.name) ?? args.defaultValue,
    args.max,
  );
  if (parsed <= 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `${args.name} must be a positive integer`,
    );
  }
  return parsed;
}
