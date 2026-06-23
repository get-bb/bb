import { join } from "node:path";
import { agentProviderIdSchema, isAgentProviderId } from "@bb/agent-providers";
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
const CUSTOM_ACP_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export interface BbAppManagedConfigWarningLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface ParseBbAppManagedConfigOptions {
  logger?: BbAppManagedConfigWarningLogger;
}

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

export const bbAppManagedEnvNameSchema = z
  .string()
  .regex(PORTABLE_ENV_NAME_PATTERN);

export const bbAppManagedEnvConfigSchema = z.record(
  bbAppManagedEnvNameSchema,
  z.string(),
);

export function formatCustomAcpAgentProviderId(id: string): string {
  return `acp-${id}`;
}

const customAcpAgentModelCliSchema = z
  .object({
    listArgs: z.array(z.string()).default([]),
    selectFlag: z.string().min(1).optional(),
    primaryModels: z.array(z.string()).default([]),
  })
  .strict()
  .transform((modelCli) =>
    modelCli.listArgs.length > 0 ? modelCli : undefined,
  );

// One user-registered ACP agent. `id` is a slug; BB derives the runtime
// provider id as `acp-<id>`.
export const customAcpAgentSchema = z
  .object({
    id: z.string().regex(CUSTOM_ACP_AGENT_ID_PATTERN),
    displayName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(bbAppManagedEnvNameSchema, z.string()).default({}),
    cwd: z.string().min(1).optional(),
    modelCli: customAcpAgentModelCliSchema.optional(),
  })
  .strict()
  .superRefine((agent, context) => {
    const providerId = formatCustomAcpAgentProviderId(agent.id);
    if (isAgentProviderId(providerId)) {
      context.addIssue({
        code: "custom",
        message: `Custom ACP agent id "${agent.id}" resolves to built-in provider "${providerId}".`,
        path: ["id"],
      });
    }
  })
  .transform(({ modelCli, ...agent }) => {
    return modelCli === undefined ? agent : { ...agent, modelCli };
  });

const customAcpAgentsSchema = z
  .array(customAcpAgentSchema)
  .superRefine((agents, context) => {
    const seenProviderIds = new Set<string>();
    for (const [index, agent] of agents.entries()) {
      const providerId = formatCustomAcpAgentProviderId(agent.id);
      if (seenProviderIds.has(providerId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate custom ACP agent provider id "${providerId}".`,
          path: [index, "id"],
        });
      }
      seenProviderIds.add(providerId);
    }
  });

export const bbAppManagedConfigSchema = z
  .object({
    config: bbAppManagedConfigValuesSchema.optional(),
    customAcpAgents: customAcpAgentsSchema.optional(),
    customModels: z.array(customProviderModelSchema).optional(),
    serverUrl: z.string().min(1).optional(),
  })
  .strict();

const bbAppManagedConfigBoundarySchema = z
  .object({
    config: bbAppManagedConfigValuesSchema.optional(),
    customAcpAgents: z.array(z.unknown()).optional(),
    customModels: z.array(customProviderModelSchema).optional(),
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
export type CustomAcpAgent = z.infer<typeof customAcpAgentSchema>;
export type CustomProviderModel = z.infer<typeof customProviderModelSchema>;
export type BbAppManagedConfig = z.infer<typeof bbAppManagedConfigSchema>;
export type BbAppManagedEnvConfig = z.infer<typeof bbAppManagedEnvConfigSchema>;
export type BbAppManagedEnvFile = z.infer<typeof bbAppManagedEnvFileSchema>;

function warnInvalidCustomAcpAgent(
  logger: BbAppManagedConfigWarningLogger | undefined,
  fields: Record<string, unknown>,
): void {
  logger?.warn(fields, "Ignoring invalid custom ACP agent config entry");
}

function parseCustomAcpAgents(
  entries: readonly unknown[] | undefined,
  options: ParseBbAppManagedConfigOptions,
): CustomAcpAgent[] | undefined {
  if (entries === undefined) {
    return undefined;
  }

  const agents: CustomAcpAgent[] = [];
  const seenProviderIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const result = customAcpAgentSchema.safeParse(entry);
    if (!result.success) {
      warnInvalidCustomAcpAgent(options.logger, {
        error: result.error.message,
        index,
      });
      continue;
    }

    const providerId = formatCustomAcpAgentProviderId(result.data.id);
    if (seenProviderIds.has(providerId)) {
      warnInvalidCustomAcpAgent(options.logger, {
        error: `Duplicate custom ACP agent provider id "${providerId}".`,
        index,
        providerId,
      });
      continue;
    }

    seenProviderIds.add(providerId);
    agents.push(result.data);
  }

  return agents;
}

export function parseBbAppManagedConfig(
  rawConfig: unknown,
  options: ParseBbAppManagedConfigOptions = {},
): BbAppManagedConfig {
  const parsed = bbAppManagedConfigBoundarySchema.parse(rawConfig);
  const customAcpAgents = parseCustomAcpAgents(
    parsed.customAcpAgents,
    options,
  );
  const config: BbAppManagedConfig = {};
  if (parsed.config !== undefined) {
    config.config = parsed.config;
  }
  if (customAcpAgents !== undefined) {
    config.customAcpAgents = customAcpAgents;
  }
  if (parsed.customModels !== undefined) {
    config.customModels = parsed.customModels;
  }
  if (parsed.serverUrl !== undefined) {
    config.serverUrl = parsed.serverUrl;
  }
  return config;
}

export function formatBbAppConfigPath(dataDir: string): string {
  return join(dataDir, BB_APP_CONFIG_FILE_NAME);
}

export function formatBbAppEnvPath(dataDir: string): string {
  return join(dataDir, BB_APP_ENV_FILE_NAME);
}
