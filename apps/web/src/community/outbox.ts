import { z } from "zod";
import type { Env } from "../server/env";
import { sendSurveyEmail, surveyEmail, type SendResult } from "./email";
import type { FormValues } from "./survey";

type OutboxEnv = Pick<Env, "DB" | "RESEND_API_KEY">;

export const EMAIL_MAX_ATTEMPTS = 6;
export const EMAIL_RETRY_DELAYS_MS = [
  10 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
];
const INLINE_DELAYS_MS = [0, 600];
const RETRY_BATCH = 25;

const dueRow = z.object({
  id: z.string(),
  to_email: z.string(),
  claim_link: z.string().nullable(),
  attempts: z.number(),
  answers: z.string(),
});
const answersSchema = z.record(z.string(), z.array(z.string()));

function idempotencyKey(id: string): string {
  return `community-survey/${id}`;
}

async function record(
  env: OutboxEnv,
  id: string,
  attempts: number,
  result: SendResult,
  now: number,
): Promise<void> {
  if (result === "sent") {
    await env.DB.prepare(
      "UPDATE community_survey_email_outbox SET attempts = ?, sent_at = ?, claim_link = NULL WHERE id = ?",
    )
      .bind(attempts, now, id)
      .run();
    return;
  }
  const exhausted = result === "failed" || attempts >= EMAIL_MAX_ATTEMPTS;
  await env.DB.prepare(
    "UPDATE community_survey_email_outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?",
  )
    .bind(
      exhausted ? EMAIL_MAX_ATTEMPTS : attempts,
      now + (EMAIL_RETRY_DELAYS_MS[attempts - 1] ?? 0),
      id,
    )
    .run();
}

export async function queueSurveyEmail(
  env: OutboxEnv,
  id: string,
  to: string,
  answers: FormValues,
  claimLink: string | null,
  now: number,
  wait?: (ms: number) => Promise<void>,
): Promise<boolean> {
  await env.DB.prepare(
    "INSERT INTO community_survey_email_outbox (id, to_email, claim_link, attempts, next_attempt_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(id, to, claimLink, now + EMAIL_RETRY_DELAYS_MS[0]!)
    .run();
  const result = await sendSurveyEmail(
    env.RESEND_API_KEY,
    to,
    surveyEmail(answers, claimLink),
    idempotencyKey(id),
    INLINE_DELAYS_MS,
    wait,
  );
  await record(env, id, 1, result, now);
  return result === "sent";
}

export async function retrySurveyEmails(
  env: OutboxEnv,
  now: number,
): Promise<void> {
  const due = await env.DB.prepare(
    "SELECT o.id, o.to_email, o.claim_link, o.attempts, r.answers FROM community_survey_email_outbox o JOIN community_survey_response r ON r.id = o.id WHERE o.sent_at IS NULL AND o.attempts < ? AND o.next_attempt_at <= ? ORDER BY o.next_attempt_at LIMIT ?",
  )
    .bind(EMAIL_MAX_ATTEMPTS, now, RETRY_BATCH)
    .all();
  for (const raw of due.results) {
    const row = dueRow.safeParse(raw);
    if (!row.success) continue;
    let answers: FormValues;
    try {
      answers = answersSchema.parse(JSON.parse(row.data.answers));
    } catch {
      await record(env, row.data.id, EMAIL_MAX_ATTEMPTS, "failed", now);
      continue;
    }
    const result = await sendSurveyEmail(
      env.RESEND_API_KEY,
      row.data.to_email,
      surveyEmail(answers, row.data.claim_link),
      idempotencyKey(row.data.id),
    );
    await record(env, row.data.id, row.data.attempts + 1, result, now);
  }
}
