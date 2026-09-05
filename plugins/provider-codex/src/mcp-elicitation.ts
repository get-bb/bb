import { z } from "zod";

export const CODEX_MCP_ELICITATION_KIND = "provider-codex/mcp-elicitation";

const codexComputerUsePermissionScopeSchema = z.enum(["session", "always"]);
const codexComputerUsePermissionScopesSchema = z
  .array(codexComputerUsePermissionScopeSchema)
  .min(1)
  .max(2)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: "Computer Use permission scopes must be unique",
  });

export const codexComputerUsePermissionSchema = z.strictObject({
  app: z.strictObject({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }),
  message: z.string().trim().min(1),
  scopes: codexComputerUsePermissionScopesSchema,
  warning: z.string().trim().min(1).nullable(),
  riskLevel: z.enum(["low", "high"]),
});
export type CodexComputerUsePermission = z.infer<
  typeof codexComputerUsePermissionSchema
>;

export const codexComputerUsePermissionResponseSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("accept"),
      persist: codexComputerUsePermissionScopeSchema,
    }),
    z.strictObject({ action: z.literal("decline") }),
    z.strictObject({ action: z.literal("cancel") }),
  ],
);
export type CodexComputerUsePermissionResponse = z.infer<
  typeof codexComputerUsePermissionResponseSchema
>;

export const codexComputerUseElicitationParamsSchema = z.strictObject({
  threadId: z.string().min(1),
  turnId: z.string().min(1).nullable(),
  serverName: z.literal("cua_repl"),
  mode: z.literal("form"),
  message: z.string().trim().min(1),
  requestedSchema: z.strictObject({
    type: z.literal("object"),
    properties: z.strictObject({}),
  }),
  _meta: z.object({
    codex_approval_kind: z.literal("mcp_tool_call"),
    connector_id: z.literal("computer-use"),
    connector_name: z.literal("Computer Use"),
    persist: codexComputerUsePermissionScopesSchema,
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
  }),
});

export type CodexMcpElicitationResponse =
  | {
      action: "accept";
      content: Record<string, never>;
      _meta: { persist: "session" | "always" };
    }
  | { action: "decline" | "cancel"; content: null; _meta: null };
