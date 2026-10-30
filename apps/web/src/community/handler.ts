import { sha256Hex } from "@bb/connect-db";
import { z } from "zod";
import type { Env } from "../server/env";
import {
  ALREADY_CLAIMED,
  CLAIM_NOT_OPEN,
  SOLD_OUT,
  surveyAnswers,
  surveyFields,
  validateSurvey,
  type SurveyReply,
} from "./survey";

type CommunityEnv = Pick<
  Env,
  | "DB"
  | "COMMUNITY_FORMS_ENABLED"
  | "COMMUNITY_STICKER_CLAIM_URL"
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

function claimUrl(base: string, code: string, email: string): string {
  const url = new URL(base);
  url.searchParams.set("discount", code);
  url.searchParams.set("checkout[email]", email);
  return url.href;
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
  const claimBase = env.COMMUNITY_STICKER_CLAIM_URL;
  try {
    const [response, emailRow, allocation] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      ).bind(id, Date.now(), JSON.stringify(surveyAnswers(values))),
      env.DB.prepare(
        "INSERT INTO community_survey_email (email_hash) SELECT ? WHERE changes() = 1 ON CONFLICT(email_hash) DO NOTHING",
      ).bind(await sha256Hex(emailKey(email))),
      env.DB.prepare(
        "UPDATE community_gift_code SET claimed = 1 WHERE code = (SELECT code FROM community_gift_code WHERE claimed = 0 ORDER BY random() LIMIT 1) AND changes() = 1 AND ? RETURNING code",
      ).bind(claimBase ? 1 : 0),
    ]);
    const duplicate = !response?.meta.changes;
    const code = z
      .object({ code: z.string() })
      .safeParse(allocation?.results[0]);
    const claimLink =
      claimBase && code.success
        ? claimUrl(claimBase, code.data.code, email)
        : null;
    const claimNote =
      duplicate || claimLink
        ? null
        : !emailRow?.meta.changes
          ? ALREADY_CLAIMED
          : claimBase
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
