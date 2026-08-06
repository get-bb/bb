/**
 * Versioned Work Together Principal internal request-target contract.
 *
 * A target is origin-form path plus optional query — never an absolute URL or
 * origin. Validation returns the unchanged input only when it is already
 * canonical for this version.
 */
export const INTERNAL_REQUEST_TARGET_VERSION = 1 as const;

const MAX_TARGET_LENGTH = 4096;

/**
 * Thrown when an internal request target fails the v1 canonical rules.
 * Messages must not echo the rejected target (may contain credentials).
 */
export class NonCanonicalInternalRequestTargetError extends Error {
  readonly version = INTERNAL_REQUEST_TARGET_VERSION;

  constructor() {
    super("Internal request target is not canonical");
    this.name = "NonCanonicalInternalRequestTargetError";
  }
}

function reject(): never {
  throw new NonCanonicalInternalRequestTargetError();
}

function isAsciiControlOrSpaceOrBackslash(code: number): boolean {
  return code <= 0x20 || code === 0x7f || code === 0x5c;
}

/**
 * RFC3986 component encoding: encodeURIComponent, then percent-encode the
 * characters encodeURIComponent leaves that are not unreserved (`!'()*`),
 * using uppercase hex.
 */
function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function decodeCanonicalRfc3986Component(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    reject();
  }

  if (decoded.normalize("NFC") !== decoded) {
    reject();
  }

  for (let i = 0; i < decoded.length; i += 1) {
    const code = decoded.charCodeAt(i);
    if (
      code === 0x2f || // /
      code === 0x5c || // \
      code === 0x25 || // %
      code < 0x20 ||
      code === 0x7f
    ) {
      reject();
    }
  }

  let canonical: string;
  try {
    canonical = encodeRfc3986Component(decoded);
  } catch {
    reject();
  }

  if (canonical !== raw) {
    reject();
  }

  return decoded;
}

function assertCanonicalPath(path: string): void {
  // Leading slash already verified; split preserves empty internal/trailing segments.
  const segments = path.split("/");
  // segments[0] is always "" because path begins with "/".
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i]!;
    const decoded = decodeCanonicalRfc3986Component(segment);
    if (decoded === "." || decoded === "..") {
      reject();
    }
  }
}

function assertCanonicalQuery(query: string): void {
  if (query.length === 0) {
    // Bare trailing "?"
    reject();
  }

  const fields = query.split("&");
  const seenKeys = new Set<string>();

  for (const field of fields) {
    if (field.length === 0) {
      // Empty "&" field
      reject();
    }
    const eq = field.indexOf("=");
    if (eq === -1) {
      reject();
    }
    const rawKey = field.slice(0, eq);
    const rawValue = field.slice(eq + 1);
    const key = decodeCanonicalRfc3986Component(rawKey);
    if (key.length === 0) {
      reject();
    }
    if (seenKeys.has(key)) {
      reject();
    }
    seenKeys.add(key);
    decodeCanonicalRfc3986Component(rawValue);
  }
}

/**
 * Validate that `target` is already a v1-canonical internal request target.
 * Returns the same string when valid; otherwise throws
 * {@link NonCanonicalInternalRequestTargetError} without echoing the input.
 */
export function canonicalizeInternalRequestTarget(target: string): string {
  if (typeof target !== "string") {
    reject();
  }
  if (target.length < 1 || target.length > MAX_TARGET_LENGTH) {
    reject();
  }
  if (target.charCodeAt(0) !== 0x2f) {
    // Must begin with "/"; rejects absolute URLs and other forms.
    reject();
  }
  if (target.charCodeAt(1) === 0x2f) {
    // Network-path reference "//..."
    reject();
  }

  for (let i = 0; i < target.length; i += 1) {
    const code = target.charCodeAt(i);
    if (code === 0x23) {
      // Fragment
      reject();
    }
    if (isAsciiControlOrSpaceOrBackslash(code)) {
      reject();
    }
  }

  const queryStart = target.indexOf("?");
  const path = queryStart === -1 ? target : target.slice(0, queryStart);
  assertCanonicalPath(path);

  if (queryStart !== -1) {
    assertCanonicalQuery(target.slice(queryStart + 1));
  }

  return target;
}
