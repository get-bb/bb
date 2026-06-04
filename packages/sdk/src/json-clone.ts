import type { JsonValue } from "@bb/domain";

/**
 * Deep-clones a JSON value via a JSON round-trip. Constrained to JsonValue so
 * non-JSON inputs (Dates, Maps, class instances) are rejected at compile time
 * instead of being silently corrupted.
 */
export function cloneJsonValue<TValue extends JsonValue | null | undefined>(
  value: TValue,
): TValue {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
