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
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, "invalid_request", `Invalid integer for ${name}`);
  }
  return parsed;
}

export interface ParseBoundedPositiveOptionalIntegerArgs {
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
