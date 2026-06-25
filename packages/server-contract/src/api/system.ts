import { z } from "zod";
import {
  appThemeSchema,
  availableModelSchema,
  experimentsSchema,
  featureFlagsSchema,
  providerInfoSchema,
} from "@bb/domain";

export const systemExecutionOptionsModelLoadErrorCodeSchema = z.enum([
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

export const systemExecutionOptionsQuerySchema = z
  .object({
    providerId: z.string().min(1),
    hostId: z.string().min(1),
    environmentId: z.string().min(1),
  })
  .partial();
export type SystemExecutionOptionsQuery = z.infer<
  typeof systemExecutionOptionsQuerySchema
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

export const systemConfigResponseSchema = z.object({
  /** User-opt-in experiments (Settings → Experiments), persisted server-side. */
  experiments: experimentsSchema,
  /** Active app-wide palette (built-in id or custom theme), resolved server-side. */
  appearance: appThemeSchema,
  /**
   * Names of custom themes discovered under `<data-dir>/theme/<name>/theme.css`,
   * so the Settings picker can offer them alongside the built-ins.
   */
  customThemes: z.array(z.string()),
  featureFlags: featureFlagsSchema,
  hostDaemonPort: z.number().nullable(),
  voiceTranscriptionEnabled: z.boolean(),
  /** Absolute path of the active bb data directory (where ui/, theme/, the DB live). */
  dataDir: z.string(),
});
export type SystemConfigResponse = z.infer<typeof systemConfigResponseSchema>;

/**
 * Theme catalog: the on-disk custom-theme directory plus the discovered custom
 * themes and the active palette. Drives `bb theme list` / `bb theme dir`.
 */
export const themeCatalogResponseSchema = z.object({
  /** Absolute path of the custom-theme root: `<data-dir>/theme`. */
  dir: z.string(),
  /** Discovered custom theme names (each has a `theme.css`). */
  custom: z.array(z.string()),
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

export const systemConfigReloadResponseSchema = z.object({
  ok: z.literal(true),
});
export type SystemConfigReloadResponse = z.infer<
  typeof systemConfigReloadResponseSchema
>;
