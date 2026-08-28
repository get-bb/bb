type ErrorFunction = (...args: never[]) => ErrorValue;
type ErrorValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | ErrorFunction
  | ErrorRecord
  | readonly ErrorValue[];
type ErrorRecord = { readonly [key: string]: ErrorValue };

interface ErrorExtractionOptions {
  readonly legacyKeys?: readonly string[];
}

function isText<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isFunction<T>(value: T): value is T & ErrorFunction {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Function]" || tag === "[object AsyncFunction]";
}

function isRecord<T>(value: T): value is T & ErrorRecord {
  return Object(value) === value && !Array.isArray(value) && !isFunction(value);
}

export function toRecord<T>(value: T): (T & ErrorRecord) | null {
  return isRecord(value) ? value : null;
}

function extractErrorMessageValue<T>(
  value: T,
  opts: ErrorExtractionOptions | undefined,
  seen: Set<object>,
): string | null {
  if (isText(value)) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) return null;
    return normalized;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    for (const item of value) {
      const message = extractErrorMessageValue(item, opts, seen);
      if (message) return message;
    }
    return null;
  }
  const record = toRecord(value);
  if (!record) return null;
  if (seen.has(record)) return null;
  seen.add(record);
  if (isText(record.message)) {
    const message = extractErrorMessageValue(record.message, opts, seen);
    if (message) return message;
  }
  for (const key of opts?.legacyKeys ?? ["detail"]) {
    const message = extractErrorMessageValue(record[key], opts, seen);
    if (message) return message;
  }
  return null;
}

export function extractErrorMessage<T>(
  value: T,
  opts?: ErrorExtractionOptions,
): string | null {
  return extractErrorMessageValue(value, opts, new Set());
}
