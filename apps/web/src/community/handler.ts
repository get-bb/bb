import { z } from "zod";
import type { Env } from "../server/env";
import { formPage, type FormKind } from "./form-page";
import {
  surveyQuestions,
  validateSurvey,
  type FormErrors,
  type FormValues,
} from "./survey";

const addressSchema = z.object({
  name: z.string().trim().min(1).max(250),
  address: z.string().trim().min(1).max(1000),
  country: z.string().trim().min(1).max(250),
  hat: z.enum(["Yes", "No"]).optional(),
});

const invitationSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
  z.object({ hat: z.boolean() }),
);

function getInvitation(
  request: Request,
  env: Env,
): { code: string; hat: boolean } | null {
  const codes = new URL(request.url).searchParams.getAll("c");
  const code = codes.length === 1 ? codes[0] : undefined;
  if (!code || !env.COMMUNITY_MERCH_INVITES) return null;
  try {
    const parsed = invitationSchema.safeParse(
      JSON.parse(env.COMMUNITY_MERCH_INVITES),
    );
    if (!parsed.success || !Object.hasOwn(parsed.data, code)) return null;
    return { code, hat: parsed.data[code]!.hat };
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
  env: Env,
  kind: FormKind,
): Promise<Response> {
  const enabled = env.COMMUNITY_FORMS_ENABLED === "true";
  let id: string = crypto.randomUUID();
  const invitation = kind === "merch" ? getInvitation(request, env) : null;
  const page = (extra: Partial<Parameters<typeof formPage>[0]> = {}) =>
    formPage({ kind, enabled, id, invitation, ...extra });
  if (kind === "merch" && !invitation)
    return page({ status: 404, unavailable: true });
  if (request.method === "GET") return page();
  if (!enabled)
    return page({
      status: 503,
      message: "We're not collecting responses yet. Please check back later.",
    });
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
  const allowed = new Set(
    kind === "survey"
      ? [
          "submission_id",
          ...surveyQuestions.flatMap((question) =>
            question.other
              ? [question.name, `${question.name}_other`]
              : [question.name],
          ),
        ]
      : [
          "submission_id",
          "name",
          "address",
          "country",
          ...(invitation?.hat ? ["hat"] : []),
        ],
  );
  if (!values || Object.keys(values).some((key) => !allowed.has(key)))
    return page({
      status: 400,
      message:
        "We couldn't read that response. Please fill out the form again.",
    });
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
  let errors: FormErrors = {};
  let statement: D1PreparedStatement;
  if (kind === "survey") {
    errors = validateSurvey(values);
    if (Object.keys(errors).length)
      return page({ status: 400, values, errors });
    const answers: FormValues = {};
    for (const question of surveyQuestions) {
      const selected = values[question.name]?.filter(Boolean) ?? [];
      if (selected.length) answers[question.name] = selected;
      if (question.other && selected.includes("Other"))
        answers[`${question.name}_other`] =
          values[`${question.name}_other`] ?? [];
    }
    statement = env.DB.prepare(
      "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).bind(id, Date.now(), JSON.stringify(answers));
  } else {
    const fields = Object.fromEntries(
      ["name", "address", "country", "hat"].map((name) => [
        name,
        values[name]?.length === 1 ? values[name][0] : undefined,
      ]),
    );
    const parsed = (
      invitation?.hat
        ? addressSchema.extend({ hat: z.enum(["Yes", "No"]) })
        : addressSchema
    ).safeParse(fields);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0]);
        errors[name] =
          name === "hat"
            ? "Please choose Yes or No."
            : "Please fill in this field and keep it within the length limit.";
      }
      return page({ status: 400, values, errors });
    }
    const address = parsed.data;
    statement = env.DB.prepare(
      "INSERT INTO community_merch_address (id, created_at, recipient_code, name, address, country, hat) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).bind(
      id,
      Date.now(),
      invitation!.code,
      address.name,
      address.address,
      address.country,
      invitation?.hat ? (address.hat === "Yes" ? 1 : 0) : null,
    );
  }
  try {
    await statement.run();
  } catch {
    return page({
      status: 503,
      values,
      message:
        "We couldn't save your response. Your answers are still here; please try again.",
    });
  }
  return page({ complete: true });
}
