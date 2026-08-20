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

export const experimental_providerInstallationActionKindSchema = z.enum([
  "install",
  "update",
]);
export type ExperimentalProviderInstallationActionKind = z.infer<
  typeof experimental_providerInstallationActionKindSchema
>;

/**
 * An installation action that a provider currently knows how to perform.
 * Only the display command crosses the product boundary; the executable plan
 * is resolved afresh by `provider/installation/run` on the host.
 */
export const experimental_providerInstallationActionSchema = z
  .object({
    kind: experimental_providerInstallationActionKindSchema,
    label: z.enum(["Install", "Update"]),
    command: z.string().min(1),
  })
  .passthrough();
export type ExperimentalProviderInstallationAction = z.infer<
  typeof experimental_providerInstallationActionSchema
>;

export const experimental_providerInstallationSourceSchema = z.enum([
  "notInstalled",
  "npmGlobal",
  "external",
]);
export type ExperimentalProviderInstallationSource = z.infer<
  typeof experimental_providerInstallationSourceSchema
>;

/** Provider-owned installation and update state for one host. */
export const experimental_providerInstallationStatusSchema = z
  .object({
    executableName: z.string().min(1),
    executablePath: z.string().min(1).nullable(),
    installed: z.boolean(),
    installSource: experimental_providerInstallationSourceSchema,
    currentVersion: z.string().min(1).nullable(),
    latestVersion: z.string().min(1).nullable(),
    minimumSupportedVersion: z.string().min(1).nullable(),
    npmPackageName: z.string().min(1).nullable(),
    npmGlobalPackageVersion: z.string().min(1).nullable(),
    installAction: experimental_providerInstallationActionSchema.nullable(),
    needsUpdate: z.boolean(),
    versionUnsupported: z.boolean(),
  })
  .passthrough();
export type ExperimentalProviderInstallationStatus = z.infer<
  typeof experimental_providerInstallationStatusSchema
>;

export const experimental_providerInstallationRunParamsSchema =
  experimental_providerMaintenanceParamsSchema.extend({
    action: experimental_providerInstallationActionKindSchema,
  });
export type ExperimentalProviderInstallationRunParams = z.infer<
  typeof experimental_providerInstallationRunParamsSchema
>;

/**
 * A typed process plan. The provider chooses the executable and arguments;
 * the daemon chooses the environment and cwd and owns process supervision.
 */
export const experimental_providerInstallationCommandSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).max(64),
    displayCommand: z.string().min(1),
  })
  .passthrough();
export type ExperimentalProviderInstallationCommand = z.infer<
  typeof experimental_providerInstallationCommandSchema
>;

export const experimental_providerInstallationVerificationSchema =
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
export type ExperimentalProviderInstallationVerification = z.infer<
  typeof experimental_providerInstallationVerificationSchema
>;

/**
 * `available: false` handles a stale action safely: status may have changed
 * between rendering a button and the daemon resolving the execution plan.
 */
export const experimental_providerInstallationRunResultSchema =
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
        command: experimental_providerInstallationCommandSchema,
        verification: experimental_providerInstallationVerificationSchema,
      })
      .passthrough(),
  ]);
export type ExperimentalProviderInstallationRunResult = z.infer<
  typeof experimental_providerInstallationRunResultSchema
>;
