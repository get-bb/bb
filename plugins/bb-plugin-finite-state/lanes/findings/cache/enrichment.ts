import type { Json } from "../../../lib/remote/types.js";

export interface EnrichmentValue<T> {
  value: T;
  advisory: string | null;
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

export function epssValue(
  row: Record<string, Json>,
  keys: readonly string[],
  code: string,
): EnrichmentValue<number | null> {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && JSON_NUMBER.test(value.trim())
          ? Number(value.trim())
          : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return { value: parsed, advisory: null };
    }
    return { value: null, advisory: code };
  }
  return { value: null, advisory: null };
}

export function policyCount(
  row: Record<string, Json>,
  keys: readonly string[],
  code: string,
): EnrichmentValue<number | null> {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined) continue;
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return { value, advisory: null };
    }
    return { value: null, advisory: code };
  }
  return { value: 0, advisory: null };
}
