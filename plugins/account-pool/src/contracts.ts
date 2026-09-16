import { z } from "zod";

export const DEFAULT_ACCOUNT_POOL_CONFIG = {
  anthropicUpstreamBaseUrl: "https://api.anthropic.com",
  codexUpstreamBaseUrl: "https://chatgpt.com/backend-api/codex",
  switchThreshold: 0.98,
  parentMode: "proxy" as const,
  cacheMissDebug: false,
  cacheMissMinTokens: 10_000,
};

const httpUrlSchema = z.string().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Must be an HTTP or HTTPS URL.");

const switchThresholdSchema = z
  .number()
  .positive("Must be greater than 0.")
  .max(1, "Must be at most 1.");

const cacheMissMinTokensSchema = z
  .number()
  .int("Must be a whole number.")
  .positive("Must be greater than 0.");

export const parentModeSchema = z.enum(["proxy", "isolate"]);
export type ParentMode = z.infer<typeof parentModeSchema>;

export const accountPoolConfigSchema = z
  .object({
    anthropicUpstreamBaseUrl: httpUrlSchema.default(
      DEFAULT_ACCOUNT_POOL_CONFIG.anthropicUpstreamBaseUrl,
    ),
    codexUpstreamBaseUrl: httpUrlSchema.default(
      DEFAULT_ACCOUNT_POOL_CONFIG.codexUpstreamBaseUrl,
    ),
    switchThreshold: switchThresholdSchema.default(
      DEFAULT_ACCOUNT_POOL_CONFIG.switchThreshold,
    ),
    parentMode: parentModeSchema.default(
      DEFAULT_ACCOUNT_POOL_CONFIG.parentMode,
    ),
    cacheMissDebug: z
      .boolean()
      .default(DEFAULT_ACCOUNT_POOL_CONFIG.cacheMissDebug),
    cacheMissMinTokens: cacheMissMinTokensSchema.default(
      DEFAULT_ACCOUNT_POOL_CONFIG.cacheMissMinTokens,
    ),
  })
  .strict();

export type AccountPoolConfig = z.infer<typeof accountPoolConfigSchema>;

export const accountPoolConfigSetInputSchema = z
  .object({
    anthropicUpstreamBaseUrl: httpUrlSchema.optional(),
    codexUpstreamBaseUrl: httpUrlSchema.optional(),
    switchThreshold: switchThresholdSchema.optional(),
    parentMode: parentModeSchema.optional(),
    cacheMissDebug: z.boolean().optional(),
    cacheMissMinTokens: cacheMissMinTokensSchema.optional(),
  })
  .strict();

export const poolAvailabilitySchema = z
  .object({ claude: z.boolean(), codex: z.boolean() })
  .strict();

export type PoolAvailability = z.infer<typeof poolAvailabilitySchema>;

export const UNAVAILABLE_POOL: PoolAvailability = {
  claude: false,
  codex: false,
};

export type AccountPoolConfigSetInput = z.infer<
  typeof accountPoolConfigSetInputSchema
>;

export interface AccountPoolConfigController {
  get: () => AccountPoolConfig;
  set: (input: AccountPoolConfigSetInput) => Promise<AccountPoolConfig>;
}

export const providerSchema = z.enum(["claude", "codex"]);
export type PoolProvider = z.infer<typeof providerSchema>;
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

export const EMPTY_FAMILY_WEEKLY: FamilyWeekly = {
  fable: null,
  sonnet: null,
  opus: null,
  haiku: null,
  other: null,
};

export const limitWindowSlotSchema = z.enum(["primary", "secondary"]);

export type LimitWindowSlot = z.infer<typeof limitWindowSlotSchema>;

export const limitWindowSchema = z
  .object({
    slot: limitWindowSlotSchema,
    windowMinutes: z.number().int().positive().nullable(),
    ...familyQuotaSchema.shape,
  })
  .strict();

export type LimitWindow = z.infer<typeof limitWindowSchema>;

export const accountSchema = z
  .object({
    id: z.string().uuid(),
    provider: providerSchema,
    kind: accountKindSchema,
    label: z.string().min(1),
    email: z.string().email().nullable(),
    accountUuid: z.string().uuid().nullable().default(null),
    codexAccountId: z.string().min(1).optional(),
    subscriptionType: z.string().nullable(),
    rateLimitTier: z.string().nullable(),
    enabled: z.boolean(),
    priority: z.number().int(),
    createdAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().nullable().default(null),
    lastUsedHostId: z.string().min(1).nullable().default(null),
  })
  .strict();

export type Account = z.infer<typeof accountSchema>;

export const oauthSecretSchema = z
  .object({
    kind: z.literal("oauth"),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive().nullable(),
    idToken: z.string().min(1).optional(),
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

const quotaFieldsShape = {
  fiveHourUtilization: z.number().nullable(),
  fiveHourResetAt: z.number().int().nullable(),
  fiveHourStatus: z.string().nullable(),
  sevenDayUtilization: z.number().nullable(),
  sevenDayResetAt: z.number().int().nullable(),
  sevenDayStatus: z.string().nullable(),
  representativeClaim: z.string().nullable(),
  familyWeekly: familyWeeklySchema,
  limitWindows: z.array(limitWindowSchema),
  observedAt: z.number().int().nullable(),
  heldUntil: z.number().int().nullable(),
  error: z.string().nullable(),
};

export const quotaSchema = z
  .object({
    accountId: z.string().uuid(),
    ...quotaFieldsShape,
  })
  .strict();

export type AccountQuota = z.infer<typeof quotaSchema>;

export const accountSummarySchema = accountSchema.extend({
  lastUsedHostName: z.string().min(1).nullable(),
  ...quotaFieldsShape,
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
    accounts: z.array(accountSummarySchema),
    routing: z.object({ claude: z.boolean(), codex: z.boolean() }).strict(),
    parent: z
      .object({
        baseUrl: z.string(),
        mode: parentModeSchema,
        availability: poolAvailabilitySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export type PoolStatus = z.infer<typeof statusSchema>;

export const routedThreadStatusListSchema = z.array(routedThreadStatusSchema);

export const statusReportSchema = statusSchema
  .extend({ routedThreadsWithoutLocalLogin: routedThreadStatusListSchema })
  .strict();

export type PoolStatusReport = z.infer<typeof statusReportSchema>;

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

export const codexLoginStartSchema = z
  .object({
    sessionId: z.string().uuid(),
    verificationUri: z.string().url(),
    userCode: z.string().min(1),
    expiresAt: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
  })
  .strict();

export const codexLoginPollInputSchema = z
  .object({ sessionId: z.string().uuid() })
  .strict();

export const codexLoginCancelSchema = z
  .object({ cancelled: z.boolean() })
  .strict();

export const codexLoginPollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }).strict(),
  z
    .object({ status: z.literal("complete"), account: accountSummarySchema })
    .strict(),
  z.object({ status: z.literal("error"), message: z.string().min(1) }).strict(),
]);

export const accountIdInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const accountPriorityInputSchema = z
  .object({ accountId: z.string().uuid(), priority: z.number().int() })
  .strict();

export const accountReorderInputSchema = z
  .object({
    provider: providerSchema,
    accountIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

export const routingSetInputSchema = z
  .object({ provider: providerSchema, enabled: z.boolean() })
  .strict();

export const tokenRotateInputSchema = z
  .object({ machine: z.string().min(1) })
  .strict();

export const bypassInputSchema = z
  .object({ threadId: z.string().min(1), bypassed: z.boolean() })
  .strict();

export const cacheMissCauseKindSchema = z.enum([
  "account-switch",
  "model-change",
  "idle-gap",
  "concurrent-request",
  "parameter-change",
  "compaction",
  "prompt-change",
  "lookback-window",
  "unexplained",
]);

export const cacheMissCauseSchema = z
  .object({ kind: cacheMissCauseKindSchema, message: z.string().min(1) })
  .strict();

export type CacheMissCause = z.infer<typeof cacheMissCauseSchema>;

export const cacheMissDivergenceSchema = z
  .object({
    level: z.enum(["tools", "system", "messages", "instructions", "input"]),
    path: z.string().min(1),
    label: z.string().nullable(),
    change: z.enum(["modified", "inserted", "removed"]),
    offset: z.number().int().nonnegative().nullable(),
    before: z.string().nullable(),
    after: z.string().nullable(),
    keyOrderOnly: z.boolean(),
    sharedSegments: z.number().int().nonnegative(),
    previousSegments: z.number().int().nonnegative(),
    currentSegments: z.number().int().nonnegative(),
  })
  .strict();

export type CacheMissDivergence = z.infer<typeof cacheMissDivergenceSchema>;

export const cacheMissUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type CacheMissUsage = z.infer<typeof cacheMissUsageSchema>;

export const cacheMissReportSchema = z
  .object({
    id: z.string().uuid(),
    observedAt: z.number().int().nonnegative(),
    provider: providerSchema,
    model: z.string().nullable(),
    sessionId: z.string().min(1),
    hostId: z.string().min(1),
    hostName: z.string().min(1).nullable(),
    accountId: z.string().uuid(),
    accountLabel: z.string().min(1),
    previous: z
      .object({
        observedAt: z.number().int().nonnegative(),
        accountId: z.string().uuid(),
        accountLabel: z.string().min(1),
        model: z.string().nullable(),
        usage: cacheMissUsageSchema,
      })
      .strict(),
    usage: cacheMissUsageSchema,
    expectedCachedTokens: z.number().int().nonnegative(),
    missedTokens: z.number().int().positive(),
    causes: z.array(cacheMissCauseSchema).min(1),
    divergence: cacheMissDivergenceSchema.nullable(),
  })
  .strict();

export type CacheMissReport = z.infer<typeof cacheMissReportSchema>;

export const cacheMissReportListSchema = z.array(cacheMissReportSchema);

export interface CacheMissController {
  list: () => Promise<CacheMissReport[]>;
  clear: () => Promise<number>;
  forwardsToParent: () => boolean;
}
