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

export const CODEX_COMPUTER_USE_SERVER_NAME = "cua_repl";

const TOOL_APPROVAL_MAX_PARAMS = 50;
const TOOL_APPROVAL_MAX_TEXT_LENGTH = 2000;
const TOOL_APPROVAL_PARAMS_BYTE_BUDGET = 32 * 1024;

export function truncateCodePoints(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let truncated = "";
  for (const codePoint of text) {
    if (truncated.length + codePoint.length > maxLength - 1) break;
    truncated += codePoint;
  }
  return `${truncated.trimEnd()}…`;
}

const scopeSchema = z.enum(["session", "always"]);
const uniqueScopes = (scopes: string[]) =>
  new Set(scopes).size === scopes.length;
const scopesSchema = z.array(scopeSchema).min(1).max(2).refine(uniqueScopes, {
  message: "Computer Use permission scopes must be unique",
});
const toolApprovalScopesSchema = z
  .array(scopeSchema)
  .max(2)
  .refine(uniqueScopes, { message: "Tool approval scopes must be unique" });
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
    iconDataUrl: z
      .string()
      .max(200_000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
      .nullable(),
  }),
  scopes: scopesSchema,
  warning: z.string().trim().min(1).nullable(),
  riskLevel: z.enum(["low", "high"]),
});
export type CodexComputerUsePermission = z.infer<
  typeof codexComputerUsePermissionSchema
>;

export const codexMcpToolApprovalSchema = z.strictObject({
  ...common,
  kind: z.literal("tool_approval"),
  toolName: z.string().trim().min(1).nullable(),
  toolDescription: z.string().trim().min(1).nullable(),
  params: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        label: z.string().min(1),
        value: z.string(),
      }),
    )
    .max(TOOL_APPROVAL_MAX_PARAMS),
  omittedParamCount: z.number().int().min(0),
  scopes: toolApprovalScopesSchema,
});
export type CodexMcpToolApproval = z.infer<typeof codexMcpToolApprovalSchema>;

const httpUrlSchema = z.url({ protocol: /^https?$/ });
export const codexMcpElicitationSchema = z.discriminatedUnion("kind", [
  codexComputerUsePermissionSchema,
  codexMcpToolApprovalSchema,
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
const persistedAcceptResponseSchema = z.strictObject({
  action: z.literal("accept"),
  persist: scopeSchema,
});
export const codexMcpElicitationResponseSchema = z.union([
  persistedAcceptResponseSchema,
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
  connector_id: z.literal("computer-use"),
});
const toolApprovalMarkerSchema = z.object({
  codex_approval_kind: z.literal("mcp_tool_call"),
});
const optionalTextSchema = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  });
const toolApprovalMetadataSchema = z.object({
  persist: z
    .array(z.string())
    .nullish()
    .transform((scopes) => [
      ...new Set(
        (scopes ?? []).filter((scope) => scopeSchema.safeParse(scope).success),
      ),
    ])
    .pipe(toolApprovalScopesSchema),
  tool_title: optionalTextSchema,
  tool_name: optionalTextSchema,
  tool_description: optionalTextSchema,
  tool_params: z.record(z.string(), z.unknown()).nullish(),
  tool_params_display: z
    .array(
      z.object({
        name: z.string().min(1),
        display_name: z.string().nullish(),
        value: z.unknown(),
      }),
    )
    .nullish(),
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

function displayToolParamValue(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  return truncateCodePoints(text, TOOL_APPROVAL_MAX_TEXT_LENGTH);
}

function normalizeToolApproval(
  base: { serverName: string; message: string },
  meta: unknown,
): CodexMcpToolApproval {
  const metadata = toolApprovalMetadataSchema.parse(meta);
  const allParams =
    metadata.tool_params_display?.map((param) => ({
      name: param.name,
      label: param.display_name?.trim() || param.name,
      value: displayToolParamValue(param.value),
    })) ??
    Object.entries(metadata.tool_params ?? {}).map(([name, value]) => ({
      name,
      label: name,
      value: displayToolParamValue(value),
    }));
  const encoder = new TextEncoder();
  const shownParams: CodexMcpToolApproval["params"] = [];
  let usedBytes = 0;
  for (const param of allParams.slice(0, TOOL_APPROVAL_MAX_PARAMS)) {
    usedBytes += encoder.encode(JSON.stringify(param)).length;
    if (usedBytes > TOOL_APPROVAL_PARAMS_BYTE_BUDGET) break;
    shownParams.push(param);
  }
  return {
    ...base,
    kind: "tool_approval",
    toolName: metadata.tool_title ?? metadata.tool_name,
    toolDescription:
      metadata.tool_description === null
        ? null
        : truncateCodePoints(
            metadata.tool_description,
            TOOL_APPROVAL_MAX_TEXT_LENGTH,
          ),
    params: shownParams,
    omittedParamCount: allParams.length - shownParams.length,
    scopes: metadata.persist,
  };
}

export function normalizeCodexMcpElicitation(input: unknown): {
  threadId: string;
  turnId: string | null;
  elicitation: CodexMcpElicitation;
} {
  const params = envelopeSchema.parse(input);
  const base = { serverName: params.serverName, message: params.message };
  const isComputerUse =
    params.serverName === CODEX_COMPUTER_USE_SERVER_NAME &&
    computerUseMarkerSchema.safeParse(params._meta).success;
  const isToolApproval =
    !isComputerUse &&
    params.mode === "form" &&
    toolApprovalMarkerSchema.safeParse(params._meta).success &&
    emptyFormSchema.safeParse(params.requestedSchema).success;
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
          iconDataUrl: null,
        },
        scopes: metadata.persist,
        warning: metadata.subtitle ?? null,
        riskLevel: metadata.riskLevel,
      };
    } else if (isToolApproval) {
      elicitation = normalizeToolApproval(base, params._meta);
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
            : isToolApproval
              ? "The tool approval details are incomplete or unsupported."
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

export const CODEX_MCP_ELICITATION_CANCEL_RESPONSE = {
  action: "cancel",
  content: null,
  _meta: null,
} as const satisfies CodexNativeMcpElicitationResponse;

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
    case "tool_approval":
      if ("content" in response)
        throw new Error("Tool approval does not include form values.");
      if (
        "persist" in response &&
        !elicitation.scopes.includes(response.persist)
      )
        throw new Error(
          `Tool approval did not offer the requested scope: ${response.persist}`,
        );
      return {
        action: "accept",
        content: {},
        _meta: "persist" in response ? { persist: response.persist } : null,
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
