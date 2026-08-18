import { z } from "zod";
import {
  appSettingsSchema,
  appDefaultKeybindingsSchema,
  appKeybindingOverridesSchema,
  appKeybindingsSchema,
  appThemeSchema,
  availableModelSchema,
  experimentsSchema,
  featureFlagsSchema,
  permissionModeSchema,
  pluginThemeMetaSchema,
  providerInfoSchema,
} from "@bb/domain";
import { hostPlatformSchema } from "@bb/host-daemon-contract/local";

export const systemExecutionOptionsModelLoadErrorCodeSchema = z.enum([
  "provider_unavailable",
  "missing_executable",
  "auth_required",
  "timeout",
  "failed",
]);
export type SystemExecutionOptionsModelLoadErrorCode = z.infer<
  typeof systemExecutionOptionsModelLoadErrorCodeSchema
>;

export const systemExecutionOptionsModelLoadErrorSchema = z.object({
  providerId: z.string().min(1),
  code: systemExecutionOptionsModelLoadErrorCodeSchema,
});
export type SystemExecutionOptionsModelLoadError = z.infer<
  typeof systemExecutionOptionsModelLoadErrorSchema
>;

export const systemExecutionOptionsResponseSchema = z.object({
  providers: z.array(providerInfoSchema),
  /**
   * Highest permission mode the routed machine allows (Settings → Machines →
   * Permission limit). Pickers disable anything above it, and the server
   * resolves any higher request down to it. "full" when the machine is
   * uncapped or no machine could be routed.
   */
  permissionCeiling: permissionModeSchema,
  /** Active models offered as fresh picker choices. */
  models: z.array(availableModelSchema),
  /**
   * Retired/legacy models the picker no longer offers but that may still be
   * the user's stored selection. Clients prepend the matching entry when a
   * stored model isn't in `models`, so deprecation doesn't silently rewrite
   * the user's choice.
   */
  selectedOnlyModels: z.array(availableModelSchema),
  /**
   * Error for the provider whose model list was requested. Null means the
   * lookup completed or no provider was available to query.
   */
  modelLoadError: systemExecutionOptionsModelLoadErrorSchema.nullable(),
});
export type SystemExecutionOptionsResponse = z.infer<
  typeof systemExecutionOptionsResponseSchema
>;

const systemProviderHostQueryFields = {
  hostId: z.string().min(1),
  environmentId: z.string().min(1),
} as const;

function rejectMultipleProviderHostSelectors(
  query: { environmentId?: string; hostId?: string },
  context: z.RefinementCtx,
): void {
  if (query.environmentId !== undefined && query.hostId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "hostId and environmentId are mutually exclusive",
    });
  }
}

/**
 * Routes provider discovery through an environment's host or an explicit
 * host. Omitting both preserves the primary-host fallback.
 */
export const systemProvidersQuerySchema = z
  .object(systemProviderHostQueryFields)
  .partial()
  .superRefine(rejectMultipleProviderHostSelectors);
export type SystemProvidersQuery = z.infer<typeof systemProvidersQuerySchema>;

export const systemExecutionOptionsQuerySchema = z
  .object({
    ...systemProviderHostQueryFields,
    providerId: z.string().min(1),
  })
  .partial()
  .superRefine(rejectMultipleProviderHostSelectors);
export type SystemExecutionOptionsQuery = z.infer<
  typeof systemExecutionOptionsQuerySchema
>;

/** Omission preserves the existing behavior of reading the primary machine. */
export const systemUsageLimitsQuerySchema = z.object({
  hostId: z.string().min(1).optional(),
});
export type SystemUsageLimitsQuery = z.infer<
  typeof systemUsageLimitsQuerySchema
>;

export interface SystemVoiceTranscriptionForm {
  [key: string]: string | Blob;
}

// SystemProviderInfo is the same shape as ProviderInfo from domain.
// Re-export with the API-facing name for backward compatibility.
export { providerInfoSchema as systemProviderInfoSchema } from "@bb/domain";
export type { ProviderInfo as SystemProviderInfo } from "@bb/domain";

export const systemVoiceTranscriptionResponseSchema = z.object({
  text: z.string(),
});
export type SystemVoiceTranscriptionResponse = z.infer<
  typeof systemVoiceTranscriptionResponseSchema
>;

/**
 * One agent row in onboarding. `planLabel` and `accountEmail` are populated
 * only for the three providers `provider.usage` covers; ACP agents report
 * presence and nothing more, and get no badge rather than a fabricated one.
 */
export const onboardingAgentSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  status: z.enum(["connected", "unauthenticated", "expired", "not_installed"]),
  planLabel: z.string().min(1).nullable(),
  accountEmail: z.string().nullable(),
  /** True only where bb has a managed installer, so only these may be offered. */
  canInstall: z.boolean(),
  /**
   * The agent's own sign-in command, when it has one. bb deliberately does not
   * drive another tool's login: it shows the command and re-checks, so
   * credentials only ever pass through the agent itself.
   */
  loginCommand: z.string().min(1).nullable(),
});
export type OnboardingAgent = z.infer<typeof onboardingAgentSchema>;

export const onboardingAgentOverviewSchema = z.object({
  agents: z.array(onboardingAgentSchema),
});
export type OnboardingAgentOverview = z.infer<
  typeof onboardingAgentOverviewSchema
>;

/** Omission reads the primary machine, matching the usage-limits route. */
export const systemOnboardingReposQuerySchema = z.object({
  hostId: z.string().min(1).optional(),
});
export type SystemOnboardingReposQuery = z.infer<
  typeof systemOnboardingReposQuerySchema
>;

/**
 * Onboarding funnel events, reported by the app and forwarded to the server's
 * anonymous telemetry. Categorical or counts only — never paths, project names,
 * or account emails.
 */
export const onboardingTelemetryEventSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("onboarding_started"),
    agentState: z.enum(["connected", "signed_out", "none"]),
    detectedAgentCount: z.number().int().min(0),
  }),
  z.object({
    name: z.literal("onboarding_step_completed"),
    step: z.enum(["agents", "projects"]),
  }),
  z.object({
    name: z.literal("onboarding_step_skipped"),
    step: z.enum(["agents", "projects"]),
  }),
  z.object({
    name: z.literal("onboarding_completed"),
    agentState: z.enum(["connected", "signed_out", "none"]),
    projectsAdded: z.number().int().min(0),
    durationMs: z.number().int().min(0),
  }),
  z.object({
    name: z.literal("onboarding_dismissed"),
    step: z.enum(["agents", "projects"]),
  }),
]);
export type OnboardingTelemetryEvent = z.infer<
  typeof onboardingTelemetryEventSchema
>;

export const systemConfigResponseSchema = z.object({
  /** App-wide Settings → General preferences, persisted server-side. */
  generalSettings: appSettingsSchema,
  /** Server-resolved keyboard bindings shared by every connected app window. */
  keybindings: appKeybindingsSchema,
  /** Server defaults, before the user's per-command overrides are applied. */
  defaultKeybindings: appDefaultKeybindingsSchema,
  /** Sparse per-command customizations; null shortcuts explicitly disable commands. */
  keybindingOverrides: appKeybindingOverridesSchema,
  /** User-opt-in experiments (Settings → Experiments), persisted server-side. */
  experiments: experimentsSchema,
  /** Active app-wide palette (built-in id or custom theme), resolved server-side. */
  appearance: appThemeSchema,
  /**
   * Names of custom themes discovered under `<data-dir>/theme/<name>/theme.css`,
   * so the Settings picker can offer them alongside the built-ins.
   */
  customThemes: z.array(z.string()),
  /** Palettes contributed by currently loaded plugins. */
  pluginThemes: z.array(pluginThemeMetaSchema),
  featureFlags: featureFlagsSchema,
  hostDaemonPort: z.number().nullable(),
  /** Base URL external host daemons should use to reach this server. */
  serverUrl: z.string().url(),
  /**
   * The server-resolved primary host (the machine running the server, or the
   * single known host). Null only on a fresh server where no host has ever
   * enrolled — clients must not guess a primary from the host list when a
   * value is present.
   */
  primaryHostId: z.string().nullable(),
  primaryHostPlatform: hostPlatformSchema.nullable(),
  voiceTranscriptionEnabled: z.boolean(),
  /** Absolute path of the active bb data directory (where ui/, theme/, the DB live). */
  dataDir: z.string(),
});
export type SystemConfigResponse = z.infer<typeof systemConfigResponseSchema>;

export const systemAttentionResponseSchema = z.object({
  hasAttention: z.boolean(),
});
export type SystemAttentionResponse = z.infer<
  typeof systemAttentionResponseSchema
>;

/**
 * Theme catalog: the on-disk custom-theme directory plus the discovered custom
 * themes and the active palette. Drives `bb theme list` / `bb theme dir`.
 */
export const themeCatalogResponseSchema = z.object({
  /** Absolute path of the custom-theme root: `<data-dir>/theme`. */
  dir: z.string(),
  /** Discovered custom theme names (each has a `theme.css`). */
  custom: z.array(z.string()),
  /** Palettes contributed by currently loaded plugins. */
  plugins: z.array(pluginThemeMetaSchema),
  /** The active palette, resolved server-side. */
  active: appThemeSchema,
});
export type ThemeCatalogResponse = z.infer<typeof themeCatalogResponseSchema>;

export const systemVersionResponseSchema = z.object({
  /** Version of the running bb-app package, read from package.json. */
  currentVersion: z.string(),
  /** Latest version published to npm, or null when the lookup is unavailable. */
  latestVersion: z.string().nullable(),
  /** Identifier for where the latest version was fetched from. */
  source: z.literal("npm"),
  /** True only when prod-mode, both versions parse, and latest > current. */
  updateAvailable: z.boolean(),
  /** Mirrors deps.config.isDevelopment so the frontend can skip the toast. */
  isDevelopment: z.boolean(),
  /** Command users should run to upgrade. Server-owned product policy. */
  upgradeCommand: z.string(),
});
export type SystemVersionResponse = z.infer<typeof systemVersionResponseSchema>;

export const systemVersionQuerySchema = z.object({
  /** "true" bypasses the server-side npm latest cache for a manual check. */
  force: z.enum(["true", "false"]).optional(),
});
export type SystemVersionQuery = z.infer<typeof systemVersionQuerySchema>;

export const systemConfigReloadResponseSchema = z.object({
  ok: z.literal(true),
});

/**
 * Whether a machine's copy of the built-in bb CLI skills matches what this
 * server would install. "unknown" covers a disconnected machine or one that
 * could not be asked.
 */
export const cliSkillMachineStatusSchema = z.enum([
  "installed",
  "outdated",
  "missing",
  "unknown",
]);
export type CliSkillMachineStatus = z.infer<typeof cliSkillMachineStatusSchema>;

export const systemCliSkillsStatusQuerySchema = z.object({
  /** Comma-separated machine ids; omit for every enrolled machine. */
  hostIds: z.string().optional(),
});
export type SystemCliSkillsStatusQuery = z.infer<
  typeof systemCliSkillsStatusQuerySchema
>;

export const systemCliSkillsStatusResponseSchema = z.object({
  machines: z.array(
    z.object({
      hostId: z.string(),
      hostName: z.string(),
      status: cliSkillMachineStatusSchema,
    }),
  ),
});
export type SystemCliSkillsStatusResponse = z.infer<
  typeof systemCliSkillsStatusResponseSchema
>;

/** The machines to copy the built-in bb CLI skills onto. */
export const systemInstallCliSkillsRequestSchema = z.object({
  hostIds: z.array(z.string().min(1)).min(1).max(64),
});
export type SystemInstallCliSkillsRequest = z.infer<
  typeof systemInstallCliSkillsRequestSchema
>;

/**
 * One entry per requested machine. A machine that is offline or otherwise
 * refuses the install fails on its own without taking the others down, so the
 * caller can report exactly which machines got the skills.
 */
export const systemInstallCliSkillsResponseSchema = z.object({
  results: z.array(
    z.discriminatedUnion("ok", [
      z.object({
        ok: z.literal(true),
        hostId: z.string(),
        hostName: z.string(),
        installations: z.array(
          z.object({
            name: z.string(),
            path: z.string(),
          }),
        ),
      }),
      z.object({
        ok: z.literal(false),
        hostId: z.string(),
        hostName: z.string(),
        errorMessage: z.string(),
      }),
    ]),
  ),
});
export type SystemInstallCliSkillsResponse = z.infer<
  typeof systemInstallCliSkillsResponseSchema
>;
export type SystemConfigReloadResponse = z.infer<
  typeof systemConfigReloadResponseSchema
>;
