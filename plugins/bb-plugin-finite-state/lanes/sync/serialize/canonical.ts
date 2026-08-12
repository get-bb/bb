import { createHash } from "node:crypto";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export class CanonicalizeError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} at ${path}`);
    this.name = "CanonicalizeError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function canonicalize(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalizeError("Canonical JSON does not support non-finite numbers", path);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object") {
    throw new CanonicalizeError(`Canonical JSON does not support ${typeof value} values`, path);
  }
  if (ancestors.has(value)) {
    throw new CanonicalizeError("Canonical JSON does not support circular references", path);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => canonicalize(item, `${path}[${index}]`, ancestors) ?? null);
    }
    if (!isPlainRecord(value)) {
      throw new CanonicalizeError("Canonical JSON supports only arrays and plain objects", path);
    }

    const entries: Array<[string, CanonicalValue]> = [];
    for (const key of Object.keys(value).sort()) {
      const item = canonicalize(value[key], childPath(path, key), ancestors);
      if (item !== undefined) {
        entries.push([key, item]);
      }
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value, "$", new WeakSet());
  if (canonical === undefined) {
    throw new CanonicalizeError("Canonical JSON requires a JSON value", "$");
  }
  return JSON.stringify(canonical);
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
