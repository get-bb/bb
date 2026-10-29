import { sha256Hex } from "@bb/connect-db";
import { z } from "zod";
import type { Env } from "../server/env";
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
  | "COMMUNITY_FORM_RATE_LIMITER"
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
  const issued = await env.DB.prepare(
    "SELECT code_hash FROM community_sticker_code WHERE code_hash = ? AND shipped = 0",
  )
    .bind(hash)
    .first();
  if (issued) return code;
  try {
    const hashes = inviteHashesSchema.safeParse(
      JSON.parse(env.COMMUNITY_MERCH_INVITE_HASHES ?? "[]"),
    );
    return hashes.success && hashes.data.includes(hash) ? code : null;
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
    key: request.headers.get("cf-connecting-ip") ?? "local-preview",
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
  const code = crypto.randomUUID().replaceAll("-", "");
  const hash = await sha256Hex(code);
  try {
    const [response, allocation] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      ).bind(id, Date.now(), JSON.stringify(surveyAnswers(values))),
      env.DB.prepare(
        "WITH RECURSIVE slots(slot) AS (SELECT 1 UNION ALL SELECT slot + 1 FROM slots WHERE slot < 250) INSERT INTO community_sticker_code (slot, code_hash) SELECT slot, ? FROM slots WHERE changes() = 1 AND slot NOT IN (SELECT slot FROM community_sticker_code) ORDER BY random() LIMIT 1",
      ).bind(hash),
    ]);
    if (!response?.meta.changes)
      return page({ complete: true, duplicate: true });
    return page({
      complete: true,
      values,
      stickerCode: allocation?.meta.changes ? code : null,
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
