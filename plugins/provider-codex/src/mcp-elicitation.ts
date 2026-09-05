import { z } from "zod";
import {
  codexMcpFormContentSchema,
  codexMcpFormFieldSchema,
  normalizeCodexMcpForm,
  validateCodexMcpFormContent,
  type CodexMcpFormContent,
} from "./mcp-elicitation-form.js";

export {
  validateCodexMcpFormContent,
  type CodexMcpFormContent,
  type CodexMcpFormField,
} from "./mcp-elicitation-form.js";

export const CODEX_MCP_ELICITATION_KIND = "provider-codex/mcp-elicitation";

const scopeSchema = z.enum(["session", "always"]);
const scopesSchema = z
  .array(scopeSchema)
  .min(1)
  .max(2)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: "Computer Use permission scopes must be unique",
  });
const common = {
  serverName: z.string().min(1),
  message: z.string().trim().min(1),
};

export const codexComputerUsePermissionSchema = z.strictObject({
  ...common,
  kind: z.literal("computer_use"),
  app: z.strictObject({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }),
  scopes: scopesSchema,
  warning: z.string().trim().min(1).nullable(),
  riskLevel: z.enum(["low", "high"]),
});
export type CodexComputerUsePermission = z.infer<
  typeof codexComputerUsePermissionSchema
>;

const httpUrlSchema = z.url({ protocol: /^https?$/ });
export const codexMcpElicitationSchema = z.discriminatedUnion("kind", [
  codexComputerUsePermissionSchema,
  z.strictObject({
    ...common,
    kind: z.literal("form"),
    fields: z.array(codexMcpFormFieldSchema),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("url"),
    url: httpUrlSchema,
    elicitationId: z.string().min(1),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("unsupported"),
    nativeMode: z.string(),
    reason: z.string(),
  }),
]);
export type CodexMcpElicitation = z.infer<typeof codexMcpElicitationSchema>;

const declinedResponseSchema = z.strictObject({ action: z.literal("decline") });
const cancelledResponseSchema = z.strictObject({ action: z.literal("cancel") });
const computerUseAcceptedResponseSchema = z.strictObject({
  action: z.literal("accept"),
  persist: scopeSchema,
});
export const codexMcpElicitationResponseSchema = z.union([
  computerUseAcceptedResponseSchema,
  z.strictObject({
    action: z.literal("accept"),
    content: codexMcpFormContentSchema,
  }),
  z.strictObject({ action: z.literal("accept") }),
  declinedResponseSchema,
  cancelledResponseSchema,
]);
export type CodexMcpElicitationResponse = z.infer<
  typeof codexMcpElicitationResponseSchema
>;

const envelopeSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1).nullable(),
  ...common,
  mode: z.string(),
  requestedSchema: z.unknown().optional(),
  url: z.unknown().optional(),
  elicitationId: z.unknown().optional(),
  _meta: z.unknown().optional(),
});
const computerUseMarkerSchema = z.object({
  connector_id: z.unknown().optional(),
  connector_name: z.unknown().optional(),
});
const computerUseMetadataSchema = z.object({
  codex_approval_kind: z.literal("mcp_tool_call"),
  connector_id: z.literal("computer-use"),
  connector_name: z.literal("Computer Use"),
  persist: scopesSchema,
  riskLevel: z.enum(["low", "high"]),
  subtitle: z.string().trim().min(1).optional(),
  tool_name: z.string().min(1),
  tool_call_id: z.string().min(1).optional(),
  tool_params: z.strictObject({ app: z.string().trim().min(1) }),
  tool_params_display: z.tuple([
    z.strictObject({
      name: z.literal("app"),
      display_name: z.literal("App"),
      value: z.string().trim().min(1),
    }),
  ]),
});
const emptyFormSchema = z.strictObject({
  type: z.literal("object"),
  properties: z.strictObject({}),
});

export function normalizeCodexMcpElicitation(input: unknown): {
  threadId: string;
  turnId: string | null;
  elicitation: CodexMcpElicitation;
} {
  const params = envelopeSchema.parse(input);
  const base = { serverName: params.serverName, message: params.message };
  const marker = computerUseMarkerSchema.safeParse(params._meta);
  const isComputerUse =
    marker.success &&
    (marker.data.connector_id === "computer-use" ||
      marker.data.connector_name === "Computer Use");
  let elicitation: CodexMcpElicitation;
  try {
    if (isComputerUse) {
      if (params.mode !== "form")
        throw new Error("Computer Use requires its native form mode.");
      emptyFormSchema.parse(params.requestedSchema);
      const metadata = computerUseMetadataSchema.parse(params._meta);
      elicitation = {
        ...base,
        kind: "computer_use",
        app: {
          id: metadata.tool_params.app,
          name: metadata.tool_params_display[0].value,
        },
        scopes: metadata.persist,
        warning: metadata.subtitle ?? null,
        riskLevel: metadata.riskLevel,
      };
    } else if (
      params.mode === "form" ||
      params.mode === "openai/form" ||
      params.mode === "openaiForm"
    ) {
      elicitation = {
        ...base,
        kind: "form",
        fields: normalizeCodexMcpForm(params.requestedSchema),
      };
    } else if (params.mode === "url") {
      elicitation = {
        ...base,
        kind: "url",
        url: httpUrlSchema.parse(params.url),
        elicitationId: z.string().min(1).parse(params.elicitationId),
      };
    } else {
      throw new Error(`Elicitation mode "${params.mode}" is not supported.`);
    }
  } catch (error) {
    elicitation = {
      ...base,
      kind: "unsupported",
      nativeMode: params.mode,
      reason:
        error instanceof z.ZodError
          ? isComputerUse
            ? "The app permission details are incomplete or unsupported."
            : params.mode === "url"
              ? "This link is not a valid HTTP or HTTPS URL, or its request identifier is missing."
              : "This form uses fields or constraints BB cannot display."
          : error instanceof Error
            ? error.message
            : "The requested elicitation cannot be represented.",
    };
  }
  return { threadId: params.threadId, turnId: params.turnId, elicitation };
}

export type CodexNativeMcpElicitationResponse =
  | {
      action: "accept";
      content: CodexMcpFormContent | null;
      _meta: { persist: "session" | "always" } | null;
    }
  | { action: "decline" | "cancel"; content: null; _meta: null };

export function buildCodexMcpElicitationResponse(
  elicitation: CodexMcpElicitation,
  response: CodexMcpElicitationResponse,
): CodexNativeMcpElicitationResponse {
  if (response.action !== "accept")
    return { action: response.action, content: null, _meta: null };
  switch (elicitation.kind) {
    case "computer_use":
      if (!("persist" in response))
        throw new Error(
          "Computer Use permission requires an offered persistence scope.",
        );
      if (!elicitation.scopes.includes(response.persist))
        throw new Error(
          `Computer Use permission did not offer the requested scope: ${response.persist}`,
        );
      return {
        action: "accept",
        content: {},
        _meta: { persist: response.persist },
      };
    case "form": {
      if (!("content" in response))
        throw new Error("Form acceptance requires the requested form values.");
      const parsed = validateCodexMcpFormContent(
        elicitation.fields,
        response.content,
      );
      if (!parsed.success)
        throw new Error(
          [
            parsed.formError,
            ...Object.entries(parsed.errors).map(
              ([name, message]) => `${name}: ${message}`,
            ),
          ]
            .filter((message) => message !== null)
            .join(" "),
        );
      return { action: "accept", content: parsed.data, _meta: null };
    }
    case "url":
      if ("content" in response || "persist" in response)
        throw new Error(
          "URL acceptance does not include form values or persistence.",
        );
      return { action: "accept", content: null, _meta: null };
    case "unsupported":
      throw new Error(
        "Unsupported elicitations can only be declined or cancelled.",
      );
  }
}
