import { sha256Hex } from "@bb/connect-db";
import { z } from "zod";
import type { Env } from "../server/env";
import {
  claimUrl,
  createStickerDiscount,
  newStickerCode,
  shopifyConfig,
  type ShopifyEnv,
} from "./shopify";
import {
  ALREADY_CLAIMED,
  CLAIM_NOT_OPEN,
  CLAIM_PENDING,
  SOLD_OUT,
  surveyAnswers,
  surveyFields,
  validateSurvey,
  type SurveyReply,
} from "./survey";

type CommunityEnv = ShopifyEnv &
  Pick<
    Env,
    | "DB"
    | "COMMUNITY_FORMS_ENABLED"
    | "COMMUNITY_STICKER_LIMIT"
    | "COMMUNITY_FORM_RATE_LIMITER"
  >;

const MAX_BODY_BYTES = 16384;
const submission = z.object({
  submission_id: z.uuid(),
  answers: z
    .record(z.string(), z.array(z.string().trim()))
    .refine((values) =>
      Object.keys(values).every((name) => surveyFields.includes(name)),
    ),
});

export function emailKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return `${normalized.slice(0, at).split("+")[0]}${normalized.slice(at)}`;
}

export function rateLimitKey(ip: string | null): string {
  if (!ip) return "local-preview";
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("::");
  const groups = (part: string) =>
    part
      ? part
          .split(":")
          .flatMap((group) => (group.includes(".") ? ["0", "0"] : [group]))
      : [];
  const before = groups(head);
  const after = tail === undefined ? [] : groups(tail);
  const full = [
    ...before,
    ...Array<string>(Math.max(0, 8 - before.length - after.length)).fill("0"),
    ...after,
  ];
  return `${full
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

function reply(body: SurveyReply, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function readSubmission(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return null;
  const body = await readBody(request);
  if (body === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = submission.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function handleSurveySubmission(
  request: Request,
  env: CommunityEnv,
): Promise<Response> {
  if (
    env.COMMUNITY_FORMS_ENABLED !== "true" ||
    !env.COMMUNITY_FORM_RATE_LIMITER
  )
    return reply(
      { error: "The form is temporarily unavailable. Please try again later." },
      503,
    );
  const limit = await env.COMMUNITY_FORM_RATE_LIMITER.limit({
    key: rateLimitKey(request.headers.get("cf-connecting-ip")),
  });
  if (!limit.success)
    return reply(
      {
        error:
          "Too many submissions just now. Please wait a minute and try again.",
      },
      429,
    );
  const read = await readSubmission(request);
  if (!read)
    return reply(
      {
        error:
          "We couldn't read that response. Please reload the page and try again.",
      },
      400,
    );
  const { submission_id: id, answers: values } = read;
  const errors = validateSurvey(values);
  if (Object.keys(errors).length) return reply({ errors }, 400);
  const email = values.email?.[0] ?? "";
  const config = shopifyConfig(env);
  const stickerLimit =
    Number.parseInt(env.COMMUNITY_STICKER_LIMIT ?? "", 10) || 1000;
  const emailHash = await sha256Hex(emailKey(email));
  const code = newStickerCode();
  const now = Date.now();
  try {
    const [existing, response, claim] = await env.DB.batch([
      env.DB.prepare(
        "SELECT EXISTS(SELECT 1 FROM community_survey_email WHERE email_hash = ?) AS claimed",
      ).bind(emailHash),
      env.DB.prepare(
        "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      ).bind(id, now, JSON.stringify(surveyAnswers(values))),
      env.DB.prepare(
        "INSERT INTO community_sticker_claim (code, submission_id, status, created_at) SELECT ?, ?, 'pending', ? WHERE changes() = 1 AND ? AND NOT EXISTS (SELECT 1 FROM community_survey_email WHERE email_hash = ?) AND (SELECT COUNT(*) FROM community_sticker_claim) < ?",
      ).bind(code, id, now, config ? 1 : 0, emailHash, stickerLimit),
      env.DB.prepare(
        "INSERT INTO community_survey_email (email_hash) SELECT ? WHERE changes() = 1 ON CONFLICT(email_hash) DO NOTHING",
      ).bind(emailHash),
    ]);
    const duplicate = !response?.meta.changes;
    const reserved = config !== null && claim?.meta.changes === 1;
    const created = reserved
      ? await createStickerDiscount(config, code, id, now)
      : null;
    if (created)
      await env.DB.prepare(
        "UPDATE community_sticker_claim SET status = ?, attempts = 1, last_attempt_at = ? WHERE code = ?",
      )
        .bind(created.ok ? "created" : "pending", now, code)
        .run()
        .catch(() => undefined);
    if (created && !created.ok)
      console.error(
        JSON.stringify({
          event: "community_sticker_claim_failed",
          reason: created.reason,
        }),
      );
    const claimLink =
      config && created?.ok ? claimUrl(config, code, email) : null;
    const alreadyClaimed = z
      .object({ claimed: z.literal(1) })
      .safeParse(existing?.results[0]).success;
    const claimNote =
      duplicate || claimLink
        ? null
        : reserved
          ? CLAIM_PENDING
          : alreadyClaimed
            ? ALREADY_CLAIMED
            : config
              ? SOLD_OUT
              : CLAIM_NOT_OPEN;
    return reply({ result: { duplicate, claimLink, claimNote } });
  } catch {
    return reply(
      { error: "We couldn't save your response. Please try again." },
      503,
    );
  }
}
