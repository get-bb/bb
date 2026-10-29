import { sha256Hex } from "@bb/connect-db";
import { z } from "zod";
import type { Env } from "../server/env";
import { sendSurveyEmail, surveyEmail } from "./email";
import { formPage, type FormKind } from "./form-page";
import {
  questionVisible,
  surveyFields,
  surveyAnswers,
  validateSurvey,
  type FormValues,
} from "./survey";

type CommunityEnv = Pick<
  Env,
  | "DB"
  | "COMMUNITY_FORMS_ENABLED"
  | "COMMUNITY_MERCH_INVITE_HASHES"
  | "COMMUNITY_JOTFORM_URL"
  | "COMMUNITY_STICKER_CLAIM_URL"
  | "COMMUNITY_FORM_RATE_LIMITER"
  | "RESEND_API_KEY"
>;

const inviteHashesSchema = z.array(z.string().regex(/^[a-f0-9]{64}$/));

async function getInvitation(
  request: Request,
  env: CommunityEnv,
): Promise<string | null> {
  const codes = new URL(request.url).searchParams.getAll("c");
  const code = codes.length === 1 ? codes[0] : undefined;
  if (!code || !/^[a-zA-Z0-9_-]{16,128}$/.test(code)) return null;
  const hash = await sha256Hex(code);
  try {
    const hashes = inviteHashesSchema.safeParse(
      JSON.parse(env.COMMUNITY_MERCH_INVITE_HASHES ?? "[]"),
    );
    return hashes.success && hashes.data.includes(hash) ? code : null;
  } catch {
    return null;
  }
}

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

export function claimUrl(
  config: string | undefined,
  code: string,
  email: string,
): string | null {
  if (!config) return null;
  try {
    const url = new URL(config);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".myshopify.com") ||
      !/^\/cart\/\d+:1$/.test(url.pathname) ||
      url.search ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    url.searchParams.set("discount", code);
    url.searchParams.set("checkout[email]", email);
    return url.href;
  } catch {
    return null;
  }
}

function jotformUrl(config: string | undefined, code: string): string | null {
  if (!config) return null;
  try {
    const url = new URL(config);
    if (
      url.protocol !== "https:" ||
      !["form.jotform.com", "form.jotformeu.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    url.searchParams.set("code", code);
    return url.href;
  } catch {
    return null;
  }
}

async function readValues(request: Request): Promise<FormValues | null> {
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 16384) {
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
  const fields = new URLSearchParams(new TextDecoder().decode(body));
  const values: FormValues = Object.create(null);
  for (const [key, value] of fields) {
    (values[key] ??= []).push(value.trim());
  }
  return values;
}

export async function handleCommunityForm(
  request: Request,
  env: CommunityEnv,
  kind: FormKind,
): Promise<Response> {
  const enabled = env.COMMUNITY_FORMS_ENABLED === "true";
  let id: string = crypto.randomUUID();
  const page = (extra: Partial<Parameters<typeof formPage>[0]> = {}) =>
    formPage({
      kind,
      id,
      ...extra,
    });
  if (kind === "merch") {
    if (request.method !== "GET")
      return new Response(null, { status: 405, headers: { Allow: "GET" } });
    try {
      const code = await getInvitation(request, env);
      if (!code) return page({ status: 404, unavailable: true });
      return page({
        jotform: enabled ? jotformUrl(env.COMMUNITY_JOTFORM_URL, code) : null,
      });
    } catch {
      return page({
        status: 503,
        message: "The form is temporarily unavailable. Please try again later.",
      });
    }
  }
  if (request.method === "GET") return page();
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  if (!enabled) return page({ status: 503 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return page({
      status: 403,
      message: "Please open the form on getbb.app and try again.",
    });
  }
  if (!env.COMMUNITY_FORM_RATE_LIMITER)
    return page({
      status: 503,
      message: "The form is temporarily unavailable. Please try again later.",
    });
  const limit = await env.COMMUNITY_FORM_RATE_LIMITER.limit({
    key: rateLimitKey(request.headers.get("cf-connecting-ip")),
  });
  if (!limit.success)
    return page({
      status: 429,
      message:
        "Too many submissions just now. Please wait a minute and try again.",
    });
  const values = await readValues(request);
  const allowed = new Set(["submission_id", ...surveyFields]);
  if (!values || Object.keys(values).some((key) => !allowed.has(key))) {
    return page({
      status: 400,
      message:
        "We couldn't read that response. Please fill out the form again.",
    });
  }
  for (const name of surveyFields)
    if (!questionVisible(name, values)) delete values[name];
  const parsedId = z
    .uuid()
    .safeParse(
      values.submission_id?.length === 1 ? values.submission_id[0] : undefined,
    );
  if (!parsedId.success)
    return page({
      status: 400,
      values,
      message: "This form needs a fresh submission. Please try again.",
    });
  id = parsedId.data;
  const errors = validateSurvey(values);
  if (Object.keys(errors).length) return page({ status: 400, values, errors });
  const email = values.email?.[0] ?? "";
  const emailHash = await sha256Hex(emailKey(email));
  const claimOpen =
    claimUrl(env.COMMUNITY_STICKER_CLAIM_URL, "code", email) !== null;
  try {
    const [response, emailRow, allocation] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      ).bind(id, Date.now(), JSON.stringify(surveyAnswers(values))),
      env.DB.prepare(
        "INSERT INTO community_survey_email (email_hash) SELECT ? WHERE changes() = 1 ON CONFLICT(email_hash) DO NOTHING",
      ).bind(emailHash),
      env.DB.prepare(
        "UPDATE community_gift_code SET claimed = 1 WHERE code = (SELECT code FROM community_gift_code WHERE claimed = 0 ORDER BY random() LIMIT 1) AND changes() = 1 AND ? RETURNING code",
      ).bind(claimOpen ? 1 : 0),
    ]);
    if (!response?.meta.changes)
      return page({ complete: true, duplicate: true });
    const allocated = z
      .object({ code: z.string() })
      .safeParse(allocation?.results[0]);
    const claimLink = allocated.success
      ? claimUrl(env.COMMUNITY_STICKER_CLAIM_URL, allocated.data.code, email)
      : null;
    const alreadyClaimed = !emailRow?.meta.changes;
    const emailed =
      !alreadyClaimed &&
      (await sendSurveyEmail(
        env.RESEND_API_KEY,
        email,
        surveyEmail(surveyAnswers(values), claimLink),
      ));
    return page({
      complete: true,
      values,
      claimLink,
      claimOpen,
      alreadyClaimed,
      emailed,
    });
  } catch {
    return page({
      status: 503,
      values,
      message:
        "We couldn't save your response. Your answers are still here; please try again.",
    });
  }
}
