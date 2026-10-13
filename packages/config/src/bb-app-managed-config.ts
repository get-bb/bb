import { join } from "node:path";
import { providerNativeSkillRootsSchema } from "@bb/domain";
import { z } from "zod";

const BUNDLED_PROVIDER_IDS = [
  "codex",
  "claude-code",
  "pi",
  "acp-cursor",
] as const;

const BB_APP_CONFIG_FILE_NAME = "config.json";
const BB_APP_ENV_FILE_NAME = "env.json";

export type BbAppManagedConfigKey = "BB_APP_URL" | "BB_LOG_LEVEL";

export const BB_APP_MANAGED_CONFIG_KEYS: BbAppManagedConfigKey[] = [
  "BB_APP_URL",
  "BB_LOG_LEVEL",
];

export const REMOVED_AI_SERVICE_CONFIG_KEYS: readonly string[] = [
  "BB_INFERENCE",
  "BB_INFERENCE_FALLBACK",
  "BB_TRANSCRIPTION",
];

export const REMOVED_AI_SERVICE_CONFIG_MESSAGE =
  "BB_INFERENCE, BB_INFERENCE_FALLBACK, and BB_TRANSCRIPTION were removed. Choose AI services in Settings → AI services or with `bb settings ai-services set <task> <automatic|off|service>`.";

export const PORTABLE_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const REMOVED_CUSTOM_ACP_AGENTS_CONFIG_KEY = "customAcpAgents";
const REMOVED_CUSTOM_ACP_AGENTS_MESSAGE =
  "customAcpAgents in config.json is no longer read. Declare the agents with `bb plugin config provider-acp set customAgents '<json>'`.";

interface BbAppManagedConfigWarningLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

interface ParseBbAppManagedConfigOptions {
  logger?: BbAppManagedConfigWarningLogger;
}

const bbAppManagedConfigValuesSchema = z
  .object({
    BB_APP_URL: z.string().optional(),
    BB_LOG_LEVEL: z.string().optional(),
  })
  .strict();

const ACP_PROVIDER_ID_PATTERN = /^acp-[a-z0-9][a-z0-9-]*$/u;

const customModelProviderIdSchema = z.union([
  z.enum(BUNDLED_PROVIDER_IDS),
  z.string().regex(ACP_PROVIDER_ID_PATTERN),
]);

export const customProviderModelSchema = z
  .object({
    providerId: customModelProviderIdSchema,
    model: z.string().min(1),
    displayName: z.string().min(1).optional(),
  })
  .strict();

const bbAppManagedEnvNameSchema = z.string().regex(PORTABLE_ENV_NAME_PATTERN);

const bbAppManagedEnvConfigSchema = z.record(
  bbAppManagedEnvNameSchema,
  z.string(),
);

const bbAppManagedConfigBoundarySchema = z
  .object({
    config: bbAppManagedConfigValuesSchema.optional(),
    customModels: z.array(z.unknown()).optional(),
    sharedSkillRoots: providerNativeSkillRootsSchema.optional(),
    serverHeaders: z.record(z.string(), z.string()).optional(),
    machineCredential: z.string().min(1).optional(),
    connectMachineId: z.string().min(1).optional(),
    serverUrl: z.string().min(1).optional(),
  })
  .strict();

export const bbAppManagedEnvFileSchema = z
  .object({
    env: bbAppManagedEnvConfigSchema.optional(),
  })
  .strict();

export type BbAppManagedConfigValues = z.infer<
  typeof bbAppManagedConfigValuesSchema
>;
export type CustomProviderModel = z.infer<typeof customProviderModelSchema>;
export type BbAppManagedConfig = Omit<
  z.infer<typeof bbAppManagedConfigBoundarySchema>,
  "customModels"
> & {
  customModels?: CustomProviderModel[];
};
export type BbAppManagedEnvConfig = z.infer<typeof bbAppManagedEnvConfigSchema>;
export type BbAppManagedEnvFile = z.infer<typeof bbAppManagedEnvFileSchema>;

function parseCustomModels(
  entries: readonly unknown[] | undefined,
  options: ParseBbAppManagedConfigOptions,
): CustomProviderModel[] | undefined {
  if (entries === undefined) {
    return undefined;
  }

  const customModels: CustomProviderModel[] = [];
  for (const [index, entry] of entries.entries()) {
    const result = customProviderModelSchema.safeParse(entry);
    if (!result.success) {
      options.logger?.warn(
        { error: result.error.message, index },
        "Ignoring invalid custom model config entry",
      );
      continue;
    }
    customModels.push(result.data);
  }

  return customModels;
}

function withoutRemovedAiServiceConfig(
  rawConfig: unknown,
  options: ParseBbAppManagedConfigOptions,
): unknown {
  if (typeof rawConfig !== "object" || rawConfig === null) return rawConfig;
  const values: unknown = Reflect.get(rawConfig, "config");
  if (typeof values !== "object" || values === null) return rawConfig;
  const removed = REMOVED_AI_SERVICE_CONFIG_KEYS.filter((key) =>
    Object.hasOwn(values, key),
  );
  if (removed.length === 0) return rawConfig;
  options.logger?.warn({ keys: removed }, REMOVED_AI_SERVICE_CONFIG_MESSAGE);
  return {
    ...rawConfig,
    config: Object.fromEntries(
      Object.entries(values).filter(([key]) => !removed.includes(key)),
    ),
  };
}

function withoutRemovedCustomAcpAgents(
  rawConfig: unknown,
  options: ParseBbAppManagedConfigOptions,
): unknown {
  if (
    typeof rawConfig !== "object" ||
    rawConfig === null ||
    !Object.hasOwn(rawConfig, REMOVED_CUSTOM_ACP_AGENTS_CONFIG_KEY)
  ) {
    return rawConfig;
  }
  options.logger?.warn(
    { key: REMOVED_CUSTOM_ACP_AGENTS_CONFIG_KEY },
    REMOVED_CUSTOM_ACP_AGENTS_MESSAGE,
  );
  return Object.fromEntries(
    Object.entries(rawConfig).filter(
      ([key]) => key !== REMOVED_CUSTOM_ACP_AGENTS_CONFIG_KEY,
    ),
  );
}

export function parseBbAppManagedConfig(
  rawConfig: unknown,
  options: ParseBbAppManagedConfigOptions = {},
): BbAppManagedConfig {
  const parsed = bbAppManagedConfigBoundarySchema.parse(
    withoutRemovedCustomAcpAgents(
      withoutRemovedAiServiceConfig(rawConfig, options),
      options,
    ),
  );
  const customModels = parseCustomModels(parsed.customModels, options);
  const config: BbAppManagedConfig = {};
  if (parsed.config !== undefined) {
    config.config = parsed.config;
  }
  if (customModels !== undefined) {
    config.customModels = customModels;
  }
  if (parsed.sharedSkillRoots !== undefined) {
    config.sharedSkillRoots = parsed.sharedSkillRoots;
  }
  if (parsed.serverUrl !== undefined) {
    config.serverUrl = parsed.serverUrl;
  }
  if (parsed.serverHeaders !== undefined) {
    config.serverHeaders = parsed.serverHeaders;
  }
  if (parsed.machineCredential !== undefined) {
    config.machineCredential = parsed.machineCredential;
  }
  if (parsed.connectMachineId !== undefined) {
    config.connectMachineId = parsed.connectMachineId;
  }
  return config;
}

export function formatBbAppConfigPath(dataDir: string): string {
  return join(dataDir, BB_APP_CONFIG_FILE_NAME);
}

export function formatBbAppEnvPath(dataDir: string): string {
  return join(dataDir, BB_APP_ENV_FILE_NAME);
}
