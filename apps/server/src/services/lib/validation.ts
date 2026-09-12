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
}): { limit: number | undefined; offset: number | undefined } {
  const limit = parseOptionalInteger(args.limit, "limit");
  if (limit !== undefined && limit <= 0) {
    throw new ApiError(400, "invalid_request", "limit must be positive");
  }
  const offset = parseOptionalInteger(args.offset, "offset");
  if (offset !== undefined && offset < 0) {
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
