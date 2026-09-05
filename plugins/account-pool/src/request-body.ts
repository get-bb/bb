import { z } from "zod";
import type { ModelFamily } from "./contracts.js";
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
const accountUuidSchema = z.string().uuid().nullish();

const ACCOUNT_COMPONENT =
  /(^|_)account_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=_|$)/iu;
const SESSION_COMPONENT =
  /(?:^|_)session_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu;
const codexRequestSchema = z.object({ prompt_cache_key: z.string().nullish() });

export interface ParsedRequestBody {
  family: ModelFamily;
  affinityId: string | null;
  forAccount: (accountUuid: string | null) => Uint8Array;
}

function affinityIdentifier(value: string | null | undefined): string | null {
  return value !== undefined &&
    value !== null &&
    value.length <= 512 &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : null;
}

function parseUserId(userId: string): {
  sessionId: string | null;
  forAccount: (accountUuid: string) => string | null;
} {
  try {
    const encoded = encodedUserSchema.safeParse(JSON.parse(userId));
    if (encoded.success) {
      const originalAccount = accountUuidSchema.safeParse(
        encoded.data.account_uuid,
      );
      return {
        sessionId:
          typeof encoded.data.session_id === "string"
            ? affinityIdentifier(encoded.data.session_id)
            : null,
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
  try {
    const parsed = requestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(body)),
    );
    if (!parsed.success)
      return { family: "other", affinityId: null, forAccount: () => original };
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
      forAccount(accountUuid) {
        if (accountUuid === null || user === null) return original;
        const rewritten = user.forAccount(accountUuid);
        if (rewritten === null) return original;
        return new TextEncoder().encode(
          JSON.stringify({
            ...request,
            metadata: { ...request.metadata, user_id: rewritten },
          }),
        );
      },
    };
  } catch {
    return { family: "other", affinityId: null, forAccount: () => original };
  }
}

export function parseCodexRequestBody(
  body: Uint8Array,
  headers: Headers,
): ParsedRequestBody {
  let affinityId: string | null = null;
  const sessionId =
    affinityIdentifier(headers.get("session-id")) ??
    affinityIdentifier(headers.get("session_id"));
  if (sessionId !== null) affinityId = `session:${sessionId}`;
  else {
    try {
      const parsed = codexRequestSchema.safeParse(
        JSON.parse(new TextDecoder().decode(body)),
      );
      const cacheKey = parsed.success
        ? affinityIdentifier(parsed.data.prompt_cache_key)
        : null;
      if (cacheKey !== null) affinityId = `cache:${cacheKey}`;
    } catch {}
  }
  return { family: "other", affinityId, forAccount: () => body };
}
