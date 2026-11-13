import { z } from "zod";

export const sessionSettingApplySchema = z.enum(["live", "resume", "fresh"]);
export type SessionSettingApply = z.infer<typeof sessionSettingApplySchema>;

export const sessionSettingRuleSchema = z
  .object({
    apply: sessionSettingApplySchema,
    values: z.record(z.string(), sessionSettingApplySchema).optional(),
  })
  .passthrough();
export type SessionSettingRule = z.infer<typeof sessionSettingRuleSchema>;

export const SESSION_SETTING_KEYS = [
  "model",
  "reasoningLevel",
  "serviceTier",
  "permission",
  "env",
  "instructions",
  "dynamicTools",
  "skills",
] as const;
export const sessionSettingKeySchema = z.enum(SESSION_SETTING_KEYS);
export type SessionSettingKey = z.infer<typeof sessionSettingKeySchema>;

export const sessionSettingsDeclarationSchema = z
  .object({
    model: sessionSettingRuleSchema.optional(),
    reasoningLevel: sessionSettingRuleSchema.optional(),
    serviceTier: sessionSettingRuleSchema.optional(),
    permission: sessionSettingRuleSchema.optional(),
    env: sessionSettingRuleSchema.optional(),
    instructions: sessionSettingRuleSchema.optional(),
    dynamicTools: sessionSettingRuleSchema.optional(),
    skills: sessionSettingRuleSchema.optional(),
    sessionOptions: z.record(z.string(), sessionSettingRuleSchema).optional(),
    providerOptions: z.record(z.string(), sessionSettingRuleSchema).optional(),
  })
  .passthrough();
export type SessionSettingsDeclaration = z.infer<
  typeof sessionSettingsDeclarationSchema
>;

export const UNDECLARED_SESSION_SETTING_APPLY: Readonly<
  Record<SessionSettingKey | "sessionOptions" | "providerOptions", SessionSettingApply>
> = {
  model: "live",
  reasoningLevel: "live",
  serviceTier: "live",
  permission: "live",
  env: "resume",
  instructions: "fresh",
  dynamicTools: "resume",
  skills: "resume",
  sessionOptions: "live",
  providerOptions: "live",
};

export type SessionSettingChange =
  | { setting: SessionSettingKey; value: string | null }
  | { setting: "sessionOptions"; option: string; value: string | null }
  | { setting: "providerOptions"; option: string; value: string | null };

function ruleFor(
  declaration: SessionSettingsDeclaration,
  change: SessionSettingChange,
): SessionSettingRule | undefined {
  switch (change.setting) {
    case "sessionOptions":
      return declaration.sessionOptions?.[change.option];
    case "providerOptions":
      return declaration.providerOptions?.[change.option];
    default:
      return declaration[change.setting];
  }
}

export function mergeSessionSettingsDeclarations(
  base: SessionSettingsDeclaration,
  narrowing: SessionSettingsDeclaration | undefined,
): SessionSettingsDeclaration {
  if (narrowing === undefined) {
    return base;
  }
  return {
    ...base,
    ...narrowing,
    sessionOptions: { ...base.sessionOptions, ...narrowing.sessionOptions },
    providerOptions: { ...base.providerOptions, ...narrowing.providerOptions },
  };
}

export function classifySessionSettingChange(
  declaration: SessionSettingsDeclaration,
  change: SessionSettingChange,
): SessionSettingApply {
  const rule = ruleFor(declaration, change);
  if (rule === undefined) {
    return UNDECLARED_SESSION_SETTING_APPLY[change.setting];
  }
  if (change.value !== null) {
    const valueApply = rule.values?.[change.value];
    if (valueApply !== undefined) {
      return valueApply;
    }
  }
  return rule.apply;
}

export const sessionSettingsApplySchema = z
  .object({
    settings: z.array(sessionSettingKeySchema),
    sessionOptions: z.array(z.string().min(1)),
    providerOptions: z.array(z.string().min(1)),
  })
  .passthrough();
export type SessionSettingsApply = z.infer<typeof sessionSettingsApplySchema>;

export const EMPTY_SESSION_SETTINGS_APPLY: SessionSettingsApply = {
  settings: [],
  sessionOptions: [],
  providerOptions: [],
};

export const turnInputAdmissionSchema = z.enum(["accepted", "busy", "rejected"]);
export type TurnInputAdmission = z.infer<typeof turnInputAdmissionSchema>;

export const turnInputResultSchema = z.discriminatedUnion("admission", [
  z.object({ admission: z.literal("accepted") }).passthrough(),
  z
    .object({ admission: z.literal("busy"), message: z.string().min(1) })
    .passthrough(),
  z
    .object({ admission: z.literal("rejected"), message: z.string().min(1) })
    .passthrough(),
]);
export type TurnInputResult = z.infer<typeof turnInputResultSchema>;

export const openWorkKindSchema = z.enum([
  "backgroundTask",
  "delegation",
  "terminal",
  "interaction",
  "turn",
]);
export type OpenWorkKind = z.infer<typeof openWorkKindSchema>;

export const openWorkItemSchema = z
  .object({
    id: z.string().min(1),
    kind: openWorkKindSchema,
    description: z.string(),
  })
  .passthrough();
export type OpenWorkItem = z.infer<typeof openWorkItemSchema>;

export const threadOpenWorkParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
  })
  .passthrough();

export const threadOpenWorkResultSchema = z
  .object({ items: z.array(openWorkItemSchema) })
  .passthrough();
export type ThreadOpenWorkResult = z.infer<typeof threadOpenWorkResultSchema>;
