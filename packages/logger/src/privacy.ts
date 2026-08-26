import { chmodSync, mkdirSync } from "node:fs";

export const PRIVATE_DIRECTORY_MODE = 0o700;
const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?(?:key|token)|auth(?:orization)?|client[_-]?secret|credential(?:s)?|password|passphrase|private[_-]?key|refresh[_-]?token|secret|token)/iu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?(?:key|token)|client[_-]?secret|credential(?:s)?|password|passphrase|private[_-]?key|refresh[_-]?token|secret|token)(?:[_-][A-Za-z0-9]+)*(?:["']?\s*[:=]\s*))(\[REDACTED\]|"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}"\]]+)/giu;
const AUTHORIZATION_ASSIGNMENT_PATTERN =
  /((?:authorization|auth)(?:["']?\s*[:=]\s*))(?:(Bearer|Basic)\s+)?(\[REDACTED\]|[^\s,;}"\]]+)/giu;
const AUTHORIZATION_VALUE_PATTERN =
  /\b(?:Bearer|Basic)\s+(?:\[REDACTED\]|[^\s,;}"\]]+)/giu;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu;
const SENSITIVE_MARKER_PATTERN =
  /PRIVATE KEY|api[_-]?key|access[_-]?(?:key|token)|authorization|client[_-]?secret|credential|password|passphrase|private[_-]?key|refresh[_-]?token|secret|token|Bearer|Basic|sk-|gh[pousr]_|github_pat_|xox[baprs]-|npm_|pypi-|AIza|AKIA|ASIA|eyJ|bb(?:cm|hk)_/iu;
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gu,
  /\b(?:npm_|pypi-)[A-Za-z0-9_-]{8,}\b/gu,
  /\bAIza[A-Za-z0-9_-]{20,}\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu,
  /\bbb(?:cm|hk)_[A-Za-z0-9_-]{8,}\b/gu,
];

function redactReplacement(value: string): string {
  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return `${first}${REDACTED_VALUE}${last}`;
  }
  return REDACTED_VALUE;
}

/**
 * Replaces credential-shaped values while retaining the surrounding
 * diagnostic context. This is deliberately pattern-based: it is a safety net
 * for provider/plugin output, not encryption or a substitute for OS storage
 * protections.
 */
export function redactSensitiveText(text: string): string {
  if (!SENSITIVE_MARKER_PATTERN.test(text)) {
    return text;
  }

  let redacted = text;
  if (/PRIVATE KEY/iu.test(redacted)) {
    redacted = redacted.replace(PRIVATE_KEY_PATTERN, REDACTED_VALUE);
  }
  if (/authorization|\bauth\b/iu.test(redacted)) {
    redacted = redacted.replace(
      AUTHORIZATION_ASSIGNMENT_PATTERN,
      (_match, prefix: string, scheme: string | undefined, value: string) =>
        `${prefix}${scheme === undefined ? "" : `${scheme} `}${redactReplacement(value)}`,
    );
  }
  redacted = redacted.replace(
    AUTHORIZATION_VALUE_PATTERN,
    (match) => `${match.split(/\s+/u)[0]} ${REDACTED_VALUE}`,
  );
  if (SENSITIVE_KEY_PATTERN.test(redacted)) {
    redacted = redacted.replace(
      SENSITIVE_ASSIGNMENT_PATTERN,
      (_match, prefix: string, value: string) =>
        `${prefix}${redactReplacement(value)}`,
    );
  }
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED_VALUE);
  }
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactSensitiveValue(
  value: unknown,
  key: string | undefined,
  seen: Map<object, object>,
): unknown {
  if (typeof value === "string") {
    return key !== undefined && SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED_VALUE
      : redactSensitiveText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  // Error instances are passed to Pino's error serializer, which applies the
  // same text redaction to messages, stacks, and causes without changing the
  // original error object.
  if (value instanceof Error || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const result: unknown[] = [];
    seen.set(value, result);
    for (const entry of value) {
      result.push(redactSensitiveValue(entry, undefined, seen));
    }
    return result;
  }
  let objectTag: string;
  try {
    objectTag = Object.prototype.toString.call(value);
  } catch {
    return value;
  }
  if (objectTag !== "[object Object]") {
    return value;
  }
  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = redactSensitiveValue(entryValue, entryKey, seen);
  }
  return result;
}

export function redactSensitiveLogValue(value: unknown): unknown {
  return redactSensitiveValue(value, undefined, new Map());
}

export function redactSensitiveLogObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const redacted = redactSensitiveLogValue(value);
  return isRecord(redacted) ? redacted : value;
}

/** Create or repair a directory so only the current OS user can access it. */
export function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, {
    mode: PRIVATE_DIRECTORY_MODE,
    recursive: true,
  });
  chmodSync(directory, PRIVATE_DIRECTORY_MODE);
}
