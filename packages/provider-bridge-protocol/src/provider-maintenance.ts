import { z } from "zod";

/**
 * Sessionless provider maintenance query. `providerOptions` carries the same
 * provider-scoped statics as model/list (notably an ACP launch spec), while
 * `providerId` lets one bridge implementation serve several provider ids.
 */
export const experimental_providerMaintenanceParamsSchema = z
  .object({
    providerId: z.string().min(1),
    cwd: z.string().min(1).optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ExperimentalProviderMaintenanceParams = z.infer<
  typeof experimental_providerMaintenanceParamsSchema
>;

/**
 * Cheap, host-local readiness reported by a provider implementation. Network
 * usage and update checks deliberately live outside this result so choosing a
 * provider for the composer never waits on them.
 */
export const experimental_providerHealthSchema = z
  .object({
    status: z.enum([
      "ready",
      "not_installed",
      "unauthenticated",
      "expired",
      "unsupported_version",
      "unknown",
    ]),
    statusMessage: z.string().min(1).nullable(),
    accountEmail: z.string().nullable(),
    planLabel: z.string().min(1).nullable(),
    installedVersion: z.string().min(1).nullable(),
    minimumSupportedVersion: z.string().min(1).nullable(),
    canInstall: z.boolean(),
    canUpdate: z.boolean(),
    loginCommand: z.string().min(1).nullable(),
  })
  .passthrough();

export type ExperimentalProviderHealth = z.infer<
  typeof experimental_providerHealthSchema
>;

/** One usage window reported by a provider subscription. */
export const experimental_providerUsageWindowSchema = z
  .object({
    label: z.string().min(1),
    usedPercent: z.number().min(0).max(100),
    resetsAt: z.string().min(1).nullable(),
    cost: z
      .object({
        usedUsdCents: z.number().int().nonnegative(),
        limitUsdCents: z.number().int().positive(),
      })
      .optional(),
  })
  .passthrough();

export type ExperimentalProviderUsageWindow = z.infer<
  typeof experimental_providerUsageWindowSchema
>;

/** Live usage for one provider, normalized by that provider's bridge. */
export const experimental_providerUsageSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      accountEmail: z.string().email().nullable(),
      planLabel: z.string().min(1).nullable(),
      windows: z.array(experimental_providerUsageWindowSchema),
    })
    .passthrough(),
  z.object({ status: z.literal("not_installed") }).passthrough(),
  z.object({ status: z.literal("unauthenticated") }).passthrough(),
  z.object({ status: z.literal("expired") }).passthrough(),
  z
    .object({
      status: z.literal("error"),
      message: z.string().min(1),
      planLabel: z.string().min(1).nullable().default(null),
      accountEmail: z.string().nullable().default(null),
    })
    .passthrough(),
]);

export type ExperimentalProviderUsage = z.infer<
  typeof experimental_providerUsageSchema
>;

export const experimental_providerHealthResultSchema = z.discriminatedUnion(
  "supported",
  [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        health: experimental_providerHealthSchema,
      })
      .passthrough(),
  ],
);

export type ExperimentalProviderHealthResult = z.infer<
  typeof experimental_providerHealthResultSchema
>;

export const experimental_providerUsageResultSchema = z.discriminatedUnion(
  "supported",
  [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        usage: experimental_providerUsageSchema,
      })
      .passthrough(),
  ],
);

export type ExperimentalProviderUsageResult = z.infer<
  typeof experimental_providerUsageResultSchema
>;
