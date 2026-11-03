import { z } from "zod";
import type { ModelFamily } from "./contracts.js";
import { modelFamily } from "./quota.js";

const requestSchema = z.object({
  model: z.string().nullish(),
  metadata: z.object({ user_id: z.string().nullish() }).nullish(),
});

const encodedUserSchema = z.object({}).passthrough();
const accountUuidSchema = z.string().uuid().nullish();

const ACCOUNT_COMPONENT =
  /(^|_)account_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=_|$)/iu;
const SESSION_COMPONENT =
  /(?:^|_)session_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu;

export type RequestBodyParts = readonly Uint8Array[];

export interface ParsedRequestBody {
  family: ModelFamily;
  affinityId: string | null;
  parentAffinityId: string | null;
  forAccount: (accountUuid: string | null) => RequestBodyParts;
}

interface JsonField {
  start: number;
  end: number;
  value: unknown;
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const CLAUDE_FIELDS = new Set(["model", "metadata"]);
const USER_ID_FIELD = new Set(["user_id"]);
const CODEX_FIELDS = new Set(["prompt_cache_key", "client_metadata"]);

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function skipWhitespace(bytes: Uint8Array, index: number, end: number): number {
  while (index < end && isWhitespace(bytes[index])) index++;
  return index;
}

function stringEnd(bytes: Uint8Array, start: number, end: number): number {
  let index = start + 1;
  while (true) {
    const quote = bytes.indexOf(QUOTE, index);
    if (quote === -1 || quote >= end) return -1;
    let backslashes = 0;
    while (bytes[quote - 1 - backslashes] === BACKSLASH) backslashes++;
    if (backslashes % 2 === 0) return quote + 1;
    index = quote + 1;
  }
}

function valueEnd(bytes: Uint8Array, start: number, end: number): number {
  const first = bytes[start];
  if (first === QUOTE) return stringEnd(bytes, start, end);
  if (first === OPEN_OBJECT || first === OPEN_ARRAY) {
    const closers: number[] = [];
    let index = start;
    while (index < end) {
      const byte = bytes[index];
      if (byte === QUOTE) {
        index = stringEnd(bytes, index, end);
        if (index === -1) return -1;
        continue;
      }
      if (byte === OPEN_OBJECT) closers.push(CLOSE_OBJECT);
      else if (byte === OPEN_ARRAY) closers.push(CLOSE_ARRAY);
      else if (byte === CLOSE_OBJECT || byte === CLOSE_ARRAY) {
        if (closers.pop() !== byte) return -1;
        if (closers.length === 0) return index + 1;
      }
      index++;
    }
    return -1;
  }
  let index = start;
  while (index < end) {
    const byte = bytes[index];
    if (
      byte === COMMA ||
      byte === CLOSE_OBJECT ||
      byte === CLOSE_ARRAY ||
      isWhitespace(byte)
    )
      break;
    index++;
  }
  return index === start ? -1 : index;
}

function decodeJson(bytes: Uint8Array, start: number, end: number): unknown {
  return JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
}

function readObjectFields(
  bytes: Uint8Array,
  names: ReadonlySet<string>,
  start = 0,
  end = bytes.length,
): Map<string, JsonField> | null {
  const fields = new Map<string, JsonField>();
  let index = skipWhitespace(bytes, start, end);
  if (bytes[index] !== OPEN_OBJECT) return null;
  index = skipWhitespace(bytes, index + 1, end);
  try {
    while (bytes[index] === QUOTE) {
      const keyEnd = stringEnd(bytes, index, end);
      if (keyEnd === -1) return null;
      const key = decodeJson(bytes, index, keyEnd);
      index = skipWhitespace(bytes, keyEnd, end);
      if (bytes[index] !== COLON) return null;
      const valueStart = skipWhitespace(bytes, index + 1, end);
      const valueStop = valueEnd(bytes, valueStart, end);
      if (valueStop === -1) return null;
      if (typeof key === "string" && names.has(key))
        fields.set(key, {
          start: valueStart,
          end: valueStop,
          value: decodeJson(bytes, valueStart, valueStop),
        });
      index = skipWhitespace(bytes, valueStop, end);
      if (bytes[index] !== COMMA) break;
      index = skipWhitespace(bytes, index + 1, end);
      if (bytes[index] !== QUOTE) return null;
    }
  } catch {
    return null;
  }
  if (bytes[index] !== CLOSE_OBJECT) return null;
  return skipWhitespace(bytes, index + 1, end) === end ? fields : null;
}

function affinityIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 512 &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : null;
}

function parseUserId(userId: string): {
  sessionId: string | null;
  parentSessionId: string | null;
  forAccount: (accountUuid: string) => string | null;
} {
  try {
    const encoded = encodedUserSchema.safeParse(JSON.parse(userId));
    if (encoded.success) {
      const originalAccount = accountUuidSchema.safeParse(
        encoded.data.account_uuid,
      );
      const sessionId = affinityIdentifier(encoded.data.session_id);
      const parentSessionId = affinityIdentifier(
        encoded.data.parent_session_id,
      );
      return {
        sessionId,
        parentSessionId:
          sessionId === null || parentSessionId === sessionId
            ? null
            : parentSessionId,
        forAccount(accountUuid) {
          if (
            !originalAccount.success ||
            originalAccount.data === undefined ||
            originalAccount.data === accountUuid
          )
            return null;
          return JSON.stringify({ ...encoded.data, account_uuid: accountUuid });
        },
      };
    }
  } catch {}
  return {
    sessionId: affinityIdentifier(SESSION_COMPONENT.exec(userId)?.[1]),
    parentSessionId: null,
    forAccount(accountUuid) {
      if (!ACCOUNT_COMPONENT.test(userId)) return null;
      const rewritten = userId.replace(
        ACCOUNT_COMPONENT,
        (_match, prefix: string) => `${prefix}account_${accountUuid}`,
      );
      return rewritten === userId ? null : rewritten;
    },
  };
}

export function parseRequestBody(body: Uint8Array): ParsedRequestBody {
  const original = [body];
  const unbound: ParsedRequestBody = {
    family: "other",
    affinityId: null,
    parentAffinityId: null,
    forAccount: () => original,
  };
  const fields = readObjectFields(body, CLAUDE_FIELDS);
  if (fields === null) return unbound;
  const metadata = fields.get("metadata");
  const parsed = requestSchema.safeParse({
    model: fields.get("model")?.value,
    metadata: metadata?.value,
  });
  if (!parsed.success) return unbound;
  const userId = parsed.data.metadata?.user_id;
  const user =
    userId === undefined || userId === null ? null : parseUserId(userId);
  return {
    family: modelFamily(parsed.data.model ?? null),
    affinityId:
      user?.sessionId === undefined || user.sessionId === null
        ? null
        : `session:${user.sessionId}`,
    parentAffinityId:
      user?.parentSessionId === undefined || user.parentSessionId === null
        ? null
        : `session:${user.parentSessionId}`,
    forAccount(accountUuid) {
      if (accountUuid === null || user === null || metadata === undefined)
        return original;
      const rewritten = user.forAccount(accountUuid);
      if (rewritten === null) return original;
      const field = readObjectFields(
        body,
        USER_ID_FIELD,
        metadata.start,
        metadata.end,
      )?.get("user_id");
      if (field === undefined) return original;
      return [
        body.subarray(0, field.start),
        new TextEncoder().encode(JSON.stringify(rewritten)),
        body.subarray(field.end),
      ];
    },
  };
}

function parseMetadata(
  value: string | null,
): z.infer<typeof encodedUserSchema> | null {
  if (value === null) return null;
  try {
    const parsed = encodedUserSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseCodexRequestBody(
  body: Uint8Array,
  headers: Headers,
): ParsedRequestBody {
  const request = readObjectFields(body, CODEX_FIELDS);
  const parsedClient = encodedUserSchema.safeParse(
    request?.get("client_metadata")?.value,
  );
  const client = parsedClient.success ? parsedClient.data : null;
  const headerTurn = parseMetadata(headers.get("x-codex-turn-metadata"));
  const bodyTurn = parseMetadata(
    typeof client?.["x-codex-turn-metadata"] === "string"
      ? client["x-codex-turn-metadata"]
      : null,
  );
  const sessionId =
    affinityIdentifier(headers.get("thread-id")) ??
    affinityIdentifier(headerTurn?.thread_id) ??
    affinityIdentifier(client?.thread_id) ??
    affinityIdentifier(bodyTurn?.thread_id) ??
    affinityIdentifier(headers.get("session-id")) ??
    affinityIdentifier(headers.get("session_id")) ??
    affinityIdentifier(headerTurn?.session_id) ??
    affinityIdentifier(client?.session_id) ??
    affinityIdentifier(bodyTurn?.session_id);
  const cacheKey = affinityIdentifier(request?.get("prompt_cache_key")?.value);
  const parentSessionId =
    sessionId === null
      ? null
      : ([
          headerTurn?.forked_from_thread_id,
          bodyTurn?.forked_from_thread_id,
          headers.get("x-codex-parent-thread-id"),
          headerTurn?.parent_thread_id,
          client?.["x-codex-parent-thread-id"],
          bodyTurn?.parent_thread_id,
        ]
          .map(affinityIdentifier)
          .find((value) => value !== null && value !== sessionId) ?? null);
  return {
    family: "other",
    affinityId:
      sessionId !== null
        ? `session:${sessionId}`
        : cacheKey !== null
          ? `cache:${cacheKey}`
          : null,
    parentAffinityId:
      parentSessionId === null ? null : `session:${parentSessionId}`,
    forAccount: () => [body],
  };
}
