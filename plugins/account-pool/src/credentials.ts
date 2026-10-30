import type { JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jwtPayloadSchema = z.record(z.string(), jsonValueSchema);
export const CHATGPT_AUTH_CLAIM = "https://api.openai.com/auth";
export const CHATGPT_PROFILE_CLAIM = "https://api.openai.com/profile";

export function codexAccessTokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (payload === undefined) return null;
  try {
    const parsed = jwtPayloadSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success && typeof parsed.data.exp === "number"
      ? Math.round(parsed.data.exp * 1_000)
      : null;
  } catch {
    return null;
  }
}
