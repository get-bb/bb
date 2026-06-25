import { join } from "node:path";
import { z } from "zod";

export const CLIENT_CONFIG_FILE_NAME = "client.json";

export const clientSshHostConfigSchema = z
  .object({
    sshAuthority: z.string().trim().min(1).regex(/^\S+$/u),
  })
  .strict();

export const clientServerConfigSchema = z
  .object({
    hosts: z.record(z.string().min(1), clientSshHostConfigSchema).default({}),
  })
  .strict();

export const clientConfigFileSchema = z
  .object({
    servers: z.record(z.string().min(1), clientServerConfigSchema).default({}),
  })
  .strict();

export type ClientSshHostConfig = z.infer<typeof clientSshHostConfigSchema>;
export type ClientServerConfig = z.infer<typeof clientServerConfigSchema>;
export type ClientConfig = z.infer<typeof clientConfigFileSchema>;

export interface ClientSshHostKey {
  hostId: string;
  serverOrigin: string;
}

export function formatClientConfigPath(dataDir: string): string {
  return join(dataDir, CLIENT_CONFIG_FILE_NAME);
}

export function normalizeClientServerOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid server origin: ${value}`);
  }
}

export function parseClientConfig(rawConfig: unknown): ClientConfig {
  const parsed = clientConfigFileSchema.parse(rawConfig);
  const config: ClientConfig = { servers: {} };
  for (const [rawOrigin, serverConfig] of Object.entries(parsed.servers)) {
    const serverOrigin = normalizeClientServerOrigin(rawOrigin);
    if (config.servers[serverOrigin] !== undefined) {
      throw new Error(`Duplicate server origin: ${serverOrigin}`);
    }
    config.servers[serverOrigin] = serverConfig;
  }
  return config;
}

export function resolveClientSshAuthority(
  config: ClientConfig,
  key: ClientSshHostKey,
): string | null {
  const serverOrigin = normalizeClientServerOrigin(key.serverOrigin);
  return config.servers[serverOrigin]?.hosts[key.hostId]?.sshAuthority ?? null;
}

export function listClientServerOrigins(config: ClientConfig): string[] {
  return Object.keys(config.servers).sort();
}
