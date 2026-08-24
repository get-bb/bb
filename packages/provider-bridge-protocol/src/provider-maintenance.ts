import { z } from "zod";

/**
 * Sessionless provider maintenance query. `providerOptions` carries the same
 * provider-scoped statics as model/list (notably an ACP launch spec), while
 * `providerId` lets one bridge implementation serve several provider ids.
 */
export const providerMaintenanceParamsSchema = z
  .object({
    providerId: z.string().min(1),
    cwd: z.string().min(1).optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ProviderMaintenanceParams = z.infer<
  typeof providerMaintenanceParamsSchema
>;

export const providerInstallationRequirementSchema = z.enum([
  "thread_rewind",
]);
export type ProviderInstallationRequirement = z.infer<
  typeof providerInstallationRequirementSchema
>;

export const providerInstallationStatusParamsSchema =
  providerMaintenanceParamsSchema.extend({
    requirement: providerInstallationRequirementSchema.optional(),
  });
export type ProviderInstallationStatusParams = z.infer<
  typeof providerInstallationStatusParamsSchema
>;

/**
 * Cheap, host-local readiness reported by a provider implementation. Network
 * usage and update checks deliberately live outside this result so choosing a
 * provider for the composer never waits on them.
 */
export const providerHealthSchema = z
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

export type ProviderHealth = z.infer<
  typeof providerHealthSchema
>;

/** One usage window reported by a provider subscription. */
export const providerUsageWindowSchema = z
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

export type ProviderUsageWindow = z.infer<
  typeof providerUsageWindowSchema
>;

/** Live usage for one provider, normalized by that provider's bridge. */
export const providerUsageSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      accountEmail: z.string().email().nullable(),
      planLabel: z.string().min(1).nullable(),
      windows: z.array(providerUsageWindowSchema),
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

export type ProviderUsage = z.infer<
  typeof providerUsageSchema
>;

export const providerHealthResultSchema = z.discriminatedUnion(
  "supported",
  [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        health: providerHealthSchema,
      })
      .passthrough(),
  ],
);

export type ProviderHealthResult = z.infer<
  typeof providerHealthResultSchema
>;

export const providerUsageResultSchema = z.discriminatedUnion(
  "supported",
  [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        usage: providerUsageSchema,
      })
      .passthrough(),
  ],
);

export type ProviderUsageResult = z.infer<
  typeof providerUsageResultSchema
>;

export const providerInstallationActionKindSchema = z.enum([
  "install",
  "update",
]);
export type ProviderInstallationActionKind = z.infer<
  typeof providerInstallationActionKindSchema
>;

/**
 * An installation action that a provider currently knows how to perform.
 * Only the display command crosses the product boundary; the executable plan
 * is resolved afresh by `provider/installation/run` on the host.
 */
export const providerInstallationActionSchema = z
  .object({
    kind: providerInstallationActionKindSchema,
    label: z.enum(["Install", "Update"]),
    command: z.string().min(1),
  })
  .passthrough();
export type ProviderInstallationAction = z.infer<
  typeof providerInstallationActionSchema
>;

export const providerInstallationSourceSchema = z.enum([
  "notInstalled",
  "npmGlobal",
  "external",
]);
export type ProviderInstallationSource = z.infer<
  typeof providerInstallationSourceSchema
>;

/** Provider-owned installation and update state for one host. */
export const providerInstallationStatusSchema = z
  .object({
    executableName: z.string().min(1),
    executablePath: z.string().min(1).nullable(),
    installed: z.boolean(),
    installSource: providerInstallationSourceSchema,
    currentVersion: z.string().min(1).nullable(),
    latestVersion: z.string().min(1).nullable(),
    minimumSupportedVersion: z.string().min(1).nullable(),
    npmPackageName: z.string().min(1).nullable(),
    npmGlobalPackageVersion: z.string().min(1).nullable(),
    installAction: providerInstallationActionSchema.nullable(),
    needsUpdate: z.boolean(),
    versionUnsupported: z.boolean(),
  })
  .passthrough();
export type ProviderInstallationStatus = z.infer<
  typeof providerInstallationStatusSchema
>;

export const providerInstallationRunParamsSchema =
  providerMaintenanceParamsSchema.extend({
    action: providerInstallationActionKindSchema,
  });
export type ProviderInstallationRunParams = z.infer<
  typeof providerInstallationRunParamsSchema
>;

/**
 * A typed process plan. The provider chooses the executable and arguments;
 * the daemon chooses the environment and cwd and owns process supervision.
 */
export const providerInstallationCommandSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).max(64),
    displayCommand: z.string().min(1),
  })
  .passthrough();
export type ProviderInstallationCommand = z.infer<
  typeof providerInstallationCommandSchema
>;

export const providerInstallationVerificationSchema =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("installed") }).passthrough(),
    z
      .object({
        kind: z.literal("version_changed"),
        previousVersion: z.string().min(1),
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("version_at_least"),
        version: z.string().min(1),
      })
      .passthrough(),
  ]);
export type ProviderInstallationVerification = z.infer<
  typeof providerInstallationVerificationSchema
>;

/**
 * `available: false` handles a stale action safely: status may have changed
 * between rendering a button and the daemon resolving the execution plan.
 */
export const providerInstallationRunResultSchema =
  z.discriminatedUnion("available", [
    z
      .object({
        available: z.literal(false),
        message: z.string().min(1),
      })
      .passthrough(),
    z
      .object({
        available: z.literal(true),
        command: providerInstallationCommandSchema,
        verification: providerInstallationVerificationSchema,
      })
      .passthrough(),
  ]);
export type ProviderInstallationRunResult = z.infer<
  typeof providerInstallationRunResultSchema
>;
