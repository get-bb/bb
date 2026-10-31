import { sha256Hex } from "@bb/connect-db";
import { z } from "zod";
import type { Env } from "../server/env";
import { sendSurveyEmail, surveyEmail } from "./email";
import {
  claimUrl,
  createStickerDiscount,
  newStickerCode,
  shopifyConfig,
  type CreateResult,
  type ShopifyEnv,
} from "./shopify";
import { formValues, surveyAnswers, type FormValues } from "./survey";

export const SOLD_OUT =
  "We've given out all the stickers for now. Thank you for answering.";
export const CLAIM_NOT_OPEN =
  "Sticker claims aren't open yet. We'll post in Discord when they are.";
export const ALREADY_CLAIMED =
  "This email already has a sticker code. Thank you for answering again!";

export type ClaimsEnv = ShopifyEnv &
  Pick<Env, "DB" | "COMMUNITY_STICKER_LIMIT" | "RESEND_API_KEY">;

export type EmailStatus = "sent" | "queued" | "none";
export const DELIVERY_WINDOW_MS = 30 * 24 * 60 * 60_000;
const RETRY_AFTER_MS = 5 * 60_000;
const RETRY_BATCH = 100;

const dueClaim = z.object({
  code: z.string(),
  submission_id: z.string(),
  answers: z.string(),
});

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

export async function deliverClaim(
  env: ClaimsEnv,
  claim: Claim,
  answers: FormValues,
  claimLink: string,
  now: number,
  delays: readonly number[] = [0, 600],
): Promise<EmailStatus> {
  const sent = await sendSurveyEmail(
    env.RESEND_API_KEY,
    claim.email,
    surveyEmail(answers, claimLink),
    `community-survey/${claim.submissionId}`,
    delays,
  );
  await env.DB.batch(
    sent
      ? [
          env.DB.prepare(
            "UPDATE community_survey_response SET emailed_at = ? WHERE id = ?",
          ).bind(now, claim.submissionId),
          env.DB.prepare(
            "UPDATE community_sticker_claim SET status = 'delivered', submission_id = NULL, attempts = attempts + 1, last_attempt_at = ? WHERE code = ?",
          ).bind(now, claim.code),
        ]
      : [
          env.DB.prepare(
            "UPDATE community_sticker_claim SET attempts = attempts + 1, last_attempt_at = ? WHERE code = ?",
          ).bind(now, claim.code),
        ],
  ).catch(() => undefined);
  return sent ? "sent" : "queued";
}

export async function surveyEmailStatus(
  env: ClaimsEnv,
  id: string,
): Promise<EmailStatus> {
  const row = await env.DB.prepare(
    "SELECT r.emailed_at, c.status FROM community_survey_response r LEFT JOIN community_sticker_claim c ON c.submission_id = r.id WHERE r.id = ?",
  )
    .bind(id)
    .first<{ emailed_at: number | null; status: string | null }>();
  return row?.emailed_at ? "sent" : row?.status ? "queued" : "none";
}

async function dueClaims(env: ClaimsEnv, status: string, now: number) {
  const due = await env.DB.prepare(
    "SELECT c.code, c.submission_id, r.answers FROM community_sticker_claim c JOIN community_survey_response r ON r.id = c.submission_id WHERE c.status = ? AND c.created_at < ? ORDER BY c.last_attempt_at, c.created_at LIMIT ?",
  )
    .bind(status, now - RETRY_AFTER_MS, RETRY_BATCH)
    .all();
  return due.results.flatMap((raw) => {
    const row = dueClaim.safeParse(raw);
    if (!row.success) return [];
    let answers: FormValues;
    try {
      answers = formValues.parse(JSON.parse(row.data.answers));
    } catch {
      return [];
    }
    const claim: Claim = {
      code: row.data.code,
      submissionId: row.data.submission_id,
      email: answers.email?.[0] ?? "",
    };
    return [{ claim, answers }];
  });
}

export async function runClaimRetries(
  env: ClaimsEnv,
  now: number,
): Promise<void> {
  let failure = "";
  try {
    await env.DB.prepare(
      "UPDATE community_sticker_claim SET status = 'expired', submission_id = NULL WHERE status IN ('pending', 'created') AND created_at < ?",
    )
      .bind(now - DELIVERY_WINDOW_MS)
      .run();
    const config = shopifyConfig(env);
    for (const { claim, answers } of await dueClaims(env, "created", now)) {
      if (!config) break;
      const status = await deliverClaim(
        env,
        claim,
        answers,
        claimUrl(config, claim.code, claim.email),
        now,
        [0],
      );
      if (status !== "sent") failure = "email";
    }
    for (const { claim, answers } of await dueClaims(env, "pending", now)) {
      const advanced = await advanceClaim(env, claim, now);
      if (!advanced.ok) {
        failure = advanced.kind;
        if (advanced.kind !== "rejected") break;
        continue;
      }
      if (
        (await deliverClaim(
          env,
          claim,
          answers,
          advanced.claimLink,
          now,
          [0],
        )) !== "sent"
      )
        failure = "email";
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "unknown";
  }
  if (!failure) return;
  const stuck = await env.DB.prepare(
    "SELECT COUNT(*) AS claims, MIN(created_at) AS oldest FROM community_sticker_claim WHERE status IN ('pending', 'created')",
  )
    .first<{ claims: number; oldest: number | null }>()
    .catch(() => null);
  console.error(
    JSON.stringify({
      event: "community_sticker_deliveries_stuck",
      claims: stuck?.claims ?? 0,
      oldestAgeHours: stuck?.oldest
        ? Math.floor((now - stuck.oldest) / 3_600_000)
        : 0,
      failure,
    }),
  );
}
