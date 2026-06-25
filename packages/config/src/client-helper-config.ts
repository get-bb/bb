import { join } from "node:path";
import { z } from "zod";

export const CLIENT_HELPER_CONFIG_FILE_NAME = "client-helper.json";

export const clientHelperSshHostConfigSchema = z
  .object({
    sshAuthority: z.string().trim().min(1).regex(/^\S+$/u),
  })
  .strict();

export const clientHelperServerConfigSchema = z
  .object({
    hosts: z
      .record(z.string().min(1), clientHelperSshHostConfigSchema)
      .default({}),
  })
  .strict();

export const clientHelperConfigFileSchema = z
  .object({
    servers: z
      .record(z.string().min(1), clientHelperServerConfigSchema)
      .default({}),
  })
  .strict();

export type ClientHelperSshHostConfig = z.infer<
  typeof clientHelperSshHostConfigSchema
>;
export type ClientHelperServerConfig = z.infer<
  typeof clientHelperServerConfigSchema
>;
export type ClientHelperConfig = z.infer<typeof clientHelperConfigFileSchema>;

export interface ClientHelperSshHostKey {
  hostId: string;
  serverOrigin: string;
}

export function formatClientHelperConfigPath(dataDir: string): string {
  return join(dataDir, CLIENT_HELPER_CONFIG_FILE_NAME);
}

export function normalizeClientHelperServerOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid server origin: ${value}`);
  }
}

export function parseClientHelperConfig(
  rawConfig: unknown,
): ClientHelperConfig {
  const parsed = clientHelperConfigFileSchema.parse(rawConfig);
  const config: ClientHelperConfig = { servers: {} };
  for (const [rawOrigin, serverConfig] of Object.entries(parsed.servers)) {
    const serverOrigin = normalizeClientHelperServerOrigin(rawOrigin);
    if (config.servers[serverOrigin] !== undefined) {
      throw new Error(`Duplicate server origin: ${serverOrigin}`);
    }
    config.servers[serverOrigin] = serverConfig;
  }
  return config;
}

export function resolveClientHelperSshAuthority(
  config: ClientHelperConfig,
  key: ClientHelperSshHostKey,
): string | null {
  const serverOrigin = normalizeClientHelperServerOrigin(key.serverOrigin);
  return config.servers[serverOrigin]?.hosts[key.hostId]?.sshAuthority ?? null;
}

export function listClientHelperServerOrigins(
  config: ClientHelperConfig,
): string[] {
  return Object.keys(config.servers).sort();
}
