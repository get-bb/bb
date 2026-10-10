import { z } from "zod";
import type { DecodedInteractiveRequest } from "@get-bb/plugin-sdk/provider-bridge";

export const CODEX_MCP_ELICITATION_KIND = "provider-codex/mcp-elicitation";

const text = z.string().max(8192);
const fieldBase = { title: text.nullish(), description: text.nullish() };
const fieldSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...fieldBase,
    type: z.literal("string"),
    default: text.nullish(),
    enum: z.array(text).min(1).max(64).optional(),
    minLength: z.number().int().nonnegative().nullish(),
    maxLength: z.number().int().nonnegative().nullish(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.enum(["number", "integer"]),
    default: z.number().nullish(),
    minimum: z.number().nullish(),
    maximum: z.number().nullish(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("boolean"),
    default: z.boolean().nullish(),
  }),
]);
const safeRecordInput = z
  .unknown()
  .refine(
    (value) =>
      typeof value !== "object" ||
      value === null ||
      !Object.hasOwn(value, "__proto__"),
    "Unsupported property name: __proto__",
  );
const formSchema = z
  .strictObject({
    type: z.literal("object"),
    properties: safeRecordInput.pipe(
      z.record(z.string().min(1).max(200), fieldSchema),
    ),
    required: z.array(z.string()).nullish(),
    additionalProperties: z.literal(false).optional(),
  })
  .superRefine((form, ctx) => {
    if (Object.keys(form.properties).length > 64)
      ctx.addIssue({ code: "custom", message: "Too many fields" });
    for (const name of form.required ?? []) {
      if (!Object.hasOwn(form.properties, name))
        ctx.addIssue({
          code: "custom",
          message: `Unknown required field: ${name}`,
        });
    }
  });
const persistence = z.enum(["session", "always"]);
const metadataSchema = z.object({
  persist: z.array(persistence).min(1).max(2).optional(),
  riskLevel: text.optional(),
  subtitle: text.optional(),
  tool_params_display: z
    .array(z.object({ display_name: text, value: text }))
    .max(64)
    .optional(),
});
export const mcpElicitationSchema = z.object({
  serverName: z.string().min(1).max(200),
  message: text.min(1),
  requestedSchema: formSchema,
  metadata: metadataSchema.nullable(),
});
export type McpElicitation = z.infer<typeof mcpElicitationSchema>;
const envelopeSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1).nullish(),
  serverName: z.string().min(1).max(200),
  message: text.min(1),
  mode: z.literal("form"),
  requestedSchema: formSchema,
  _meta: metadataSchema.nullish(),
});
const contentSchema = safeRecordInput.pipe(
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
);
const answerSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("accept"),
    content: contentSchema,
    persist: persistence.optional(),
  }),
  z.strictObject({ action: z.literal("decline") }),
  z.strictObject({ action: z.literal("cancel") }),
]);

export function decodeMcpElicitation(
  input: unknown,
): Pick<DecodedInteractiveRequest, "providerThreadId" | "turnId" | "payload"> {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `Unsupported or invalid MCP elicitation: ${parsed.error.message}`,
    );
  const { threadId, turnId, serverName, message, requestedSchema, _meta } =
    parsed.data;
  const data: McpElicitation = {
    serverName,
    message,
    requestedSchema,
    metadata: _meta ?? null,
  };
  if (new TextEncoder().encode(JSON.stringify(data)).length > 64 * 1024)
    throw new Error("Unsupported MCP elicitation: payload exceeds 64 KiB");
  return {
    providerThreadId: threadId,
    turnId: turnId ?? null,
    payload: { kind: CODEX_MCP_ELICITATION_KIND, title: "MCP request", data },
  };
}

export function buildMcpElicitationResponse(input: unknown, value: unknown) {
  const request = mcpElicitationSchema.parse(input);
  const answer = answerSchema.parse(value);
  if (answer.action !== "accept")
    return { action: answer.action, content: null, _meta: null };
  const { content } = answer;
  const fail = (message: string): never => {
    throw new Error(message);
  };
  for (const key of Object.keys(content)) {
    if (!Object.hasOwn(request.requestedSchema.properties, key))
      fail(`Unknown field: ${key}`);
  }
  for (const name of request.requestedSchema.required ?? []) {
    if (!Object.hasOwn(content, name)) fail(`Missing required field: ${name}`);
  }
  for (const [name, field] of Object.entries(
    request.requestedSchema.properties,
  )) {
    if (!Object.hasOwn(content, name)) continue;
    const value = content[name];
    if (field.type === "string") {
      if (typeof value !== "string") fail(`${name}: expected text`);
      const stringValue = z.string().parse(value);
      if (field.enum && !field.enum.includes(stringValue))
        fail(`${name}: invalid choice`);
      const length = Array.from(stringValue).length;
      if (field.minLength != null && length < field.minLength)
        fail(`${name}: too short`);
      if (field.maxLength != null && length > field.maxLength)
        fail(`${name}: too long`);
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") fail(`${name}: expected boolean`);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value))
        fail(`${name}: expected number`);
      const numberValue = z.number().parse(value);
      if (field.type === "integer" && !Number.isInteger(numberValue))
        fail(`${name}: expected integer`);
      if (field.minimum != null && numberValue < field.minimum)
        fail(`${name}: below minimum`);
      if (field.maximum != null && numberValue > field.maximum)
        fail(`${name}: above maximum`);
    }
  }
  const scopes = request.metadata?.persist;
  if (
    scopes
      ? !answer.persist || !scopes.includes(answer.persist)
      : answer.persist !== undefined
  )
    fail("Choose an offered permission duration");
  return {
    action: answer.action,
    content,
    _meta: answer.persist ? { persist: answer.persist } : null,
  };
}
