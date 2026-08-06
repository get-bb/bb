import { createHash } from "node:crypto";
import {
  parseThreadCommandRequestFingerprint,
  THREAD_COMMAND_REQUEST_FINGERPRINT_PREFIX,
  type CallerExecutionInputSource,
  type PermissionMode,
  type PromptInput,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadCommandRequestFingerprint,
} from "@bb/domain";

/**
 * Format version for the deterministic `message.send` request fingerprint.
 * Bump when the normalized intent shape or canonicalization rules change.
 */
export const MESSAGE_SEND_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Client intent hashed for admission identity. Excludes actor, thread ID, and
 * request ID — those are separate admission identity fields. Computed before
 * plugin expansion or other volatile server context.
 */
export type MessageSendRequestFingerprintIntent = {
  readonly input: readonly PromptInput[];
  readonly model?: string;
  readonly serviceTier?: ServiceTier;
  readonly reasoningLevel?: ReasoningLevel;
  readonly permissionMode?: PermissionMode;
  readonly executionInputSources?: {
    readonly model?: CallerExecutionInputSource;
    readonly serviceTier?: CallerExecutionInputSource;
    readonly reasoningLevel?: CallerExecutionInputSource;
    readonly permissionMode?: CallerExecutionInputSource;
  };
  readonly senderThreadId?: string;
};

type JsonCanonical =
  | null
  | boolean
  | number
  | string
  | JsonCanonical[]
  | { readonly [key: string]: JsonCanonical };

function omitUndefinedDeep(value: unknown): JsonCanonical | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    throw new Error(
      `Unsupported value type in message.send fingerprint intent: ${typeof value}`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const normalized = omitUndefinedDeep(entry);
      if (normalized === undefined) {
        throw new Error(
          "Undefined array entries are not allowed in message.send fingerprint intent",
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
 * Builds a versioned SHA-256 fingerprint over normalized `message.send` client
 * intent. Stable across object key insertion order and omitted vs explicit
 * undefined optional fields.
 */
export function fingerprintMessageSendRequest(
  intent: MessageSendRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  const normalized = omitUndefinedDeep({
    fingerprintFormatVersion: MESSAGE_SEND_REQUEST_FINGERPRINT_FORMAT_VERSION,
    input: intent.input,
    ...(intent.model !== undefined ? { model: intent.model } : {}),
    ...(intent.serviceTier !== undefined
      ? { serviceTier: intent.serviceTier }
      : {}),
    ...(intent.reasoningLevel !== undefined
      ? { reasoningLevel: intent.reasoningLevel }
      : {}),
    ...(intent.permissionMode !== undefined
      ? { permissionMode: intent.permissionMode }
      : {}),
    ...(intent.executionInputSources !== undefined
      ? { executionInputSources: intent.executionInputSources }
      : {}),
    ...(intent.senderThreadId !== undefined
      ? { senderThreadId: intent.senderThreadId }
      : {}),
  });
  if (normalized === undefined || typeof normalized !== "object") {
    throw new Error("Failed to normalize message.send fingerprint intent");
  }
  const digest = createHash("sha256")
    .update(canonicalizeJson(normalized), "utf8")
    .digest("hex");
  return parseThreadCommandRequestFingerprint(
    `${THREAD_COMMAND_REQUEST_FINGERPRINT_PREFIX}${digest}`,
  );
}
