import { sha256Hex } from "@bb/connect-db";
import { z } from "zod";
import type { Env } from "../server/env";
import {
  claimUrl,
  createStickerDiscount,
  newStickerCode,
  shopifyConfig,
  type CreateResult,
  type ShopifyEnv,
} from "./shopify";
import { surveyAnswers, type FormValues } from "./survey";

export const SOLD_OUT =
  "We've given out all the stickers for now. Thank you for answering.";
export const CLAIM_NOT_OPEN =
  "Sticker claims aren't open yet. We'll post in Discord when they are.";
export const CLAIM_PENDING = "We'll email you your sticker link shortly.";
export const ALREADY_CLAIMED =
  "This email already has a sticker code. Thank you for answering again!";

export type ClaimsEnv = ShopifyEnv &
  Pick<Env, "DB" | "COMMUNITY_STICKER_LIMIT">;

export type Claim = { code: string; submissionId: string; email: string };

export type SavedResponse = {
  duplicate: boolean;
  claim: Claim | null;
  note: string | null;
};

export function emailKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return `${normalized.slice(0, at).split("+")[0]}${normalized.slice(at)}`;
}

export async function saveResponse(
  env: ClaimsEnv,
  id: string,
  values: FormValues,
  now: number,
): Promise<SavedResponse> {
  const config = shopifyConfig(env);
  const limit = Number.parseInt(env.COMMUNITY_STICKER_LIMIT ?? "", 10) || 1000;
  const email = values.email?.[0] ?? "";
  const emailHash = await sha256Hex(emailKey(email));
  const code = newStickerCode();
  const [existing, response, reserved] = await env.DB.batch([
    env.DB.prepare(
      "SELECT EXISTS(SELECT 1 FROM community_survey_email WHERE email_hash = ?) AS claimed",
    ).bind(emailHash),
    env.DB.prepare(
      "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).bind(id, now, JSON.stringify(surveyAnswers(values))),
    env.DB.prepare(
      "INSERT INTO community_sticker_claim (code, submission_id, status, created_at) SELECT ?, ?, 'pending', ? WHERE changes() = 1 AND ? AND NOT EXISTS (SELECT 1 FROM community_survey_email WHERE email_hash = ?) AND (SELECT COUNT(*) FROM community_sticker_claim) < ?",
    ).bind(code, id, now, config ? 1 : 0, emailHash, limit),
    env.DB.prepare(
      "INSERT INTO community_survey_email (email_hash) SELECT ? WHERE changes() = 1 ON CONFLICT(email_hash) DO NOTHING",
    ).bind(emailHash),
  ]);
  const duplicate = !response?.meta.changes;
  if (reserved?.meta.changes === 1)
    return { duplicate, claim: { code, submissionId: id, email }, note: null };
  const alreadyClaimed = z
    .object({ claimed: z.literal(1) })
    .safeParse(existing?.results[0]).success;
  const note = duplicate
    ? null
    : alreadyClaimed
      ? ALREADY_CLAIMED
      : config
        ? SOLD_OUT
        : CLAIM_NOT_OPEN;
  return { duplicate, claim: null, note };
}

export type Advanced =
  | { ok: true; claimLink: string }
  | Extract<CreateResult, { ok: false }>;

export async function advanceClaim(
  env: ClaimsEnv,
  claim: Claim,
  now: number,
): Promise<Advanced> {
  const config = shopifyConfig(env);
  if (!config) return { ok: false, kind: "auth" };
  const created = await createStickerDiscount(
    config,
    claim.code,
    claim.submissionId,
    now,
  );
  await env.DB.prepare(
    "UPDATE community_sticker_claim SET status = ?, attempts = attempts + 1, last_attempt_at = ? WHERE code = ? AND status = 'pending'",
  )
    .bind(created.ok ? "created" : "pending", now, claim.code)
    .run()
    .catch(() => undefined);
  return created.ok
    ? { ok: true, claimLink: claimUrl(config, claim.code, claim.email) }
    : created;
}
