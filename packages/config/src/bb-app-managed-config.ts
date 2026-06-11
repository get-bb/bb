import { join } from "node:path";
import { agentProviderIdSchema } from "@bb/agent-providers";
import { z } from "zod";

export const BB_APP_CONFIG_FILE_NAME = "config.json";
export const BB_APP_ENV_FILE_NAME = "env.json";

export type BbAppManagedConfigKey =
  | "BB_APP_URL"
  | "BB_INFERENCE"
  | "BB_LOG_LEVEL"
  | "BB_TRANSCRIPTION";

export const BB_APP_MANAGED_CONFIG_KEYS: BbAppManagedConfigKey[] = [
  "BB_APP_URL",
  "BB_INFERENCE",
  "BB_LOG_LEVEL",
  "BB_TRANSCRIPTION",
];

export const PORTABLE_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const bbAppManagedConfigValuesSchema = z
  .object({
    BB_APP_URL: z.string().optional(),
    BB_INFERENCE: z.string().optional(),
    BB_LOG_LEVEL: z.string().optional(),
    BB_TRANSCRIPTION: z.string().optional(),
  })
  .strict();

// A user-registered model offered in the model picker in addition to the
// provider's built-in catalog (e.g. a non-public preview model id). Omitting
// `displayName` means "derive the label from the model id".
export const customProviderModelSchema = z
  .object({
    providerId: agentProviderIdSchema,
    model: z.string().min(1),
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const bbAppManagedConfigSchema = z
  .object({
    config: bbAppManagedConfigValuesSchema.optional(),
    customModels: z.array(customProviderModelSchema).optional(),
    serverUrl: z.string().min(1).optional(),
  })
  .strict();

export const bbAppManagedEnvNameSchema = z
  .string()
  .regex(PORTABLE_ENV_NAME_PATTERN);

export const bbAppManagedEnvConfigSchema = z.record(
  bbAppManagedEnvNameSchema,
  z.string(),
);

export const bbAppManagedEnvFileSchema = z
  .object({
    env: bbAppManagedEnvConfigSchema.optional(),
  })
  .strict();

export type BbAppManagedConfigValues = z.infer<
  typeof bbAppManagedConfigValuesSchema
>;
export type CustomProviderModel = z.infer<typeof customProviderModelSchema>;
export type BbAppManagedConfig = z.infer<typeof bbAppManagedConfigSchema>;
export type BbAppManagedEnvConfig = z.infer<typeof bbAppManagedEnvConfigSchema>;
export type BbAppManagedEnvFile = z.infer<typeof bbAppManagedEnvFileSchema>;

export function formatBbAppConfigPath(dataDir: string): string {
  return join(dataDir, BB_APP_CONFIG_FILE_NAME);
}

export function formatBbAppEnvPath(dataDir: string): string {
  return join(dataDir, BB_APP_ENV_FILE_NAME);
}
