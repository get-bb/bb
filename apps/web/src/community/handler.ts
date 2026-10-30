import { z } from "zod";
import type { Env } from "../server/env";
import {
  advanceClaim,
  CLAIM_PENDING,
  saveResponse,
  type ClaimsEnv,
} from "./claims";
import { surveyFields, validateSurvey, type SurveyReply } from "./survey";

type CommunityEnv = ClaimsEnv &
  Pick<Env, "COMMUNITY_FORMS_ENABLED" | "COMMUNITY_FORM_RATE_LIMITER">;

const MAX_BODY_BYTES = 16384;
const submission = z.object({
  submission_id: z.uuid(),
  answers: z
    .record(z.string(), z.array(z.string().trim()))
    .refine((values) =>
      Object.keys(values).every((name) => surveyFields.includes(name)),
    ),
});

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
  try {
    const now = Date.now();
    const saved = await saveResponse(env, id, values, now);
    const advanced = saved.claim
      ? await advanceClaim(env, saved.claim, now)
      : null;
    const claimLink = advanced?.ok ? advanced.claimLink : null;
    const claimNote =
      saved.note ?? (saved.claim && !claimLink ? CLAIM_PENDING : null);
    return reply({
      result: { duplicate: saved.duplicate, claimLink, claimNote },
    });
  } catch {
    return reply(
      { error: "We couldn't save your response. Please try again." },
      503,
    );
  }
}
