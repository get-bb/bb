import { z } from "zod";
import type { ModelFamily } from "./contracts.js";
import {
  findTopLevelJsonFields,
  parseJsonField,
  replaceJsonField,
} from "./json-fields.js";
import { modelFamily } from "./quota.js";

const requestSchema = z
  .object({
    model: z.string().nullish(),
    metadata: z
      .object({ user_id: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const encodedUserSchema = z.object({}).passthrough();
const CLAUDE_ROUTING_FIELDS: ReadonlySet<string> = new Set([
  "model",
  "metadata",
]);
const CODEX_ROUTING_FIELDS: ReadonlySet<string> = new Set([
  "client_metadata",
  "prompt_cache_key",
]);
const accountUuidSchema = z.string().uuid().nullish();

const ACCOUNT_COMPONENT =
  /(^|_)account_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=_|$)/iu;
const SESSION_COMPONENT =
  /(?:^|_)session_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu;

export interface ParsedRequestBody {
  family: ModelFamily;
  affinityId: string | null;
  parentAffinityId: string | null;
  forAccount: (accountUuid: string | null) => Uint8Array;
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
  const original = body;
  const unbound: ParsedRequestBody = {
    family: "other",
    affinityId: null,
    parentAffinityId: null,
    forAccount: () => original,
  };
  try {
    const fields = findTopLevelJsonFields(body, CLAUDE_ROUTING_FIELDS);
    if (fields === null) return unbound;
    const metadataSpan = fields.get("metadata");
    const parsed = requestSchema.safeParse({
      model: parseJsonField(body, fields.get("model")),
      metadata: parseJsonField(body, metadataSpan),
    });
    if (!parsed.success) return unbound;
    const request = parsed.data;
    const userId = request.metadata?.user_id;
    const user =
      userId === undefined || userId === null ? null : parseUserId(userId);
    return {
      family: modelFamily(request.model ?? null),
      affinityId:
        user?.sessionId === undefined || user.sessionId === null
          ? null
          : `session:${user.sessionId}`,
      parentAffinityId:
        user?.parentSessionId === undefined || user.parentSessionId === null
          ? null
          : `session:${user.parentSessionId}`,
      forAccount(accountUuid) {
        if (accountUuid === null || user === null || metadataSpan === undefined)
          return original;
        const rewritten = user.forAccount(accountUuid);
        if (rewritten === null) return original;
        return replaceJsonField(original, metadataSpan, {
          ...request.metadata,
          user_id: rewritten,
        });
      },
    };
  } catch {
    return unbound;
  }
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

function parseCodexRoutingFields(
  body: Uint8Array,
): { client_metadata: unknown; prompt_cache_key: unknown } | null {
  try {
    const fields = findTopLevelJsonFields(body, CODEX_ROUTING_FIELDS);
    if (fields === null) return null;
    return {
      client_metadata: parseJsonField(body, fields.get("client_metadata")),
      prompt_cache_key: parseJsonField(body, fields.get("prompt_cache_key")),
    };
  } catch {
    return null;
  }
}

export function parseCodexRequestBody(
  body: Uint8Array,
  headers: Headers,
): ParsedRequestBody {
  const request = parseCodexRoutingFields(body);
  const parsedClient = encodedUserSchema.safeParse(request?.client_metadata);
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
  const cacheKey = affinityIdentifier(request?.prompt_cache_key);
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
    forAccount: () => body,
  };
}
