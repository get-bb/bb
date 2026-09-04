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

const encodedUserSchema = z
  .object({ account_uuid: z.string().uuid().nullish() })
  .passthrough();

const ACCOUNT_COMPONENT =
  /(^|_)account_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=_|$)/iu;

export interface ParsedRequestBody {
  family: ModelFamily;
  forAccount: (accountUuid: string | null) => Uint8Array;
}

function rewriteUserId(userId: string, accountUuid: string): string | null {
  try {
    const encoded = encodedUserSchema.safeParse(JSON.parse(userId));
    if (encoded.success && encoded.data.account_uuid !== undefined) {
      if (encoded.data.account_uuid === accountUuid) return null;
      return JSON.stringify({ ...encoded.data, account_uuid: accountUuid });
    }
  } catch {}
  if (!ACCOUNT_COMPONENT.test(userId)) return null;
  const rewritten = userId.replace(
    ACCOUNT_COMPONENT,
    (_match, prefix: string) => `${prefix}account_${accountUuid}`,
  );
  return rewritten === userId ? null : rewritten;
}

export function parseRequestBody(body: Uint8Array): ParsedRequestBody {
  const original = body;
  try {
    const parsed = requestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(body)),
    );
    if (!parsed.success) {
      return { family: "other", forAccount: () => original };
    }
    const request = parsed.data;
    return {
      family: modelFamily(request.model ?? null),
      forAccount(accountUuid) {
        if (accountUuid === null) return original;
        const userId = request.metadata?.user_id;
        if (userId === undefined || userId === null) return original;
        const rewritten = rewriteUserId(userId, accountUuid);
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
    return { family: "other", forAccount: () => original };
  }
}
