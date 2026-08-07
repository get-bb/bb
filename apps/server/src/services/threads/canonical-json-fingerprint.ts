import { createHash } from "node:crypto";
import {
  parseThreadCommandRequestFingerprint,
  THREAD_COMMAND_REQUEST_FINGERPRINT_PREFIX,
  type ThreadCommandRequestFingerprint,
} from "@bb/domain";

type JsonCanonical =
  | null
  | boolean
  | number
  | string
  | JsonCanonical[]
  | { readonly [key: string]: JsonCanonical };

/**
 * Deep-omit undefined so omitted optional fields and explicit `undefined` hash
 * the same. Nested empty objects that only held undefined values collapse to
 * omitted fields as well.
 */
function omitUndefinedDeep(value: unknown): JsonCanonical | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    throw new Error(
      `Unsupported value type in fingerprint intent: ${typeof value}`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const normalized = omitUndefinedDeep(entry);
      if (normalized === undefined) {
        throw new Error(
          "Undefined array entries are not allowed in fingerprint intent",
        );
      }
      return normalized;
    });
  }
  const record: { [key: string]: JsonCanonical } = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const normalized = omitUndefinedDeep(
      (value as Record<string, unknown>)[key],
    );
    if (normalized !== undefined) {
      record[key] = normalized;
    }
  }
  // An object whose remaining fields were all undefined is equivalent to an
  // omitted optional field (e.g. `executionInputSources: { model: undefined }`).
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  return record;
}

function canonicalizeJson(value: JsonCanonical): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key]!)}`)
    .join(",")}}`;
}

/**
 * SHA-256 fingerprint over a normalized, key-order-stable JSON object intent.
 */
export function hashCanonicalJsonFingerprint(
  intent: unknown,
  context: string,
): ThreadCommandRequestFingerprint {
  const normalized = omitUndefinedDeep(intent);
  if (normalized === undefined || typeof normalized !== "object") {
    throw new Error(`Failed to normalize ${context} fingerprint intent`);
  }
  const digest = createHash("sha256")
    .update(canonicalizeJson(normalized), "utf8")
    .digest("hex");
  return parseThreadCommandRequestFingerprint(
    `${THREAD_COMMAND_REQUEST_FINGERPRINT_PREFIX}${digest}`,
  );
}
