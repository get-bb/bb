import { z } from "zod";

export const providerSchema = z.literal("claude");
export const accountKindSchema = z.enum(["oauth", "api-key"]);
export const modelFamilySchema = z.enum([
  "fable",
  "sonnet",
  "opus",
  "haiku",
  "other",
]);

export type ModelFamily = z.infer<typeof modelFamilySchema>;

export const familyQuotaSchema = z
  .object({
    utilization: z.number().nullable(),
    resetAt: z.number().int().nullable(),
    status: z.string().nullable(),
    observedAt: z.number().int(),
    source: z.enum(["header", "usage"]),
  })
  .strict();

export type FamilyQuota = z.infer<typeof familyQuotaSchema>;

export const familyWeeklySchema = z
  .object({
    fable: familyQuotaSchema.nullable(),
    sonnet: familyQuotaSchema.nullable(),
    opus: familyQuotaSchema.nullable(),
    haiku: familyQuotaSchema.nullable(),
    other: familyQuotaSchema.nullable(),
  })
  .strict();

export type FamilyWeekly = z.infer<typeof familyWeeklySchema>;

export const accountSchema = z
  .object({
    id: z.string().uuid(),
    provider: providerSchema,
    kind: accountKindSchema,
    label: z.string().min(1),
    email: z.string().email().nullable(),
    accountUuid: z.string().uuid().nullable().default(null),
    subscriptionType: z.string().nullable(),
    rateLimitTier: z.string().nullable(),
    enabled: z.boolean(),
    priority: z.number().int(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export type Account = z.infer<typeof accountSchema>;

export const oauthSecretSchema = z
  .object({
    kind: z.literal("oauth"),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive().nullable(),
  })
  .strict();

export const apiKeySecretSchema = z
  .object({
    kind: z.literal("api-key"),
    apiKey: z.string().min(1),
  })
  .strict();

export const accountSecretSchema = z.discriminatedUnion("kind", [
  oauthSecretSchema,
  apiKeySecretSchema,
]);

export type AccountSecret = z.infer<typeof accountSecretSchema>;

export const quotaSchema = z
  .object({
    accountId: z.string().uuid(),
    fiveHourUtilization: z.number().nullable(),
    fiveHourResetAt: z.number().int().nullable(),
    fiveHourStatus: z.string().nullable(),
    sevenDayUtilization: z.number().nullable(),
    sevenDayResetAt: z.number().int().nullable(),
    sevenDayStatus: z.string().nullable(),
    representativeClaim: z.string().nullable(),
    familyWeekly: familyWeeklySchema,
    observedAt: z.number().int().nullable(),
    heldUntil: z.number().int().nullable(),
    error: z.string().nullable(),
  })
  .strict();

export type AccountQuota = z.infer<typeof quotaSchema>;

export const accountSummarySchema = accountSchema.extend({
  fiveHourUtilization: z.number().nullable(),
  fiveHourResetAt: z.number().int().nullable(),
  fiveHourStatus: z.string().nullable(),
  sevenDayUtilization: z.number().nullable(),
  sevenDayResetAt: z.number().int().nullable(),
  sevenDayStatus: z.string().nullable(),
  representativeClaim: z.string().nullable(),
  familyWeekly: familyWeeklySchema,
  observedAt: z.number().int().nullable(),
  heldUntil: z.number().int().nullable(),
  error: z.string().nullable(),
  inFlight: z.number().int().nonnegative(),
  status: z.enum(["disabled", "ready", "held", "exhausted", "error"]),
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;

export const hubTokenSummarySchema = z
  .object({
    hostId: z.string().min(1),
    hostName: z.string().min(1).nullable(),
    mintedAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type HubTokenSummary = z.infer<typeof hubTokenSummarySchema>;

export const routedThreadStatusSchema = z
  .object({
    threadId: z.string().min(1),
    hostId: z.string().min(1),
    hostName: z.string().min(1).nullable(),
    routedAt: z.number().int().nonnegative(),
    localClaudeStatus: z.enum(["unauthenticated", "expired", "proxied"]),
  })
  .strict();

export type RoutedThreadStatus = z.infer<typeof routedThreadStatusSchema>;

export const statusSchema = z
  .object({
    route: z.string(),
    enabledAccountCount: z.number().int().nonnegative(),
    inFlight: z.number().int().nonnegative(),
    accepting: z.boolean(),
    hosts: z.array(hubTokenSummarySchema),
    routedThreadsWithoutLocalLogin: z.array(routedThreadStatusSchema),
    accounts: z.array(accountSummarySchema),
  })
  .strict();

export type PoolStatus = z.infer<typeof statusSchema>;

export const accountAddInputSchema = z
  .object({
    provider: providerSchema,
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("import") }).strict(),
      z
        .object({ kind: z.literal("api-key"), apiKey: z.string().min(1) })
        .strict(),
    ]),
    label: z.string().min(1).nullable(),
    priority: z.number().int(),
  })
  .strict();

export type AccountAddInput = z.infer<typeof accountAddInputSchema>;

export const loginStartSchema = z
  .object({
    sessionId: z.string().uuid(),
    authorizeUrl: z.string().url(),
  })
  .strict();

export const loginCompleteInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    pasted: z.string().trim().min(1),
  })
  .strict();

export const accountIdInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const tokenRotateInputSchema = z
  .object({ machine: z.string().min(1) })
  .strict();

export const bypassInputSchema = z
  .object({ threadId: z.string().min(1), bypassed: z.boolean() })
  .strict();

export const bypassResultSchema = bypassInputSchema;
