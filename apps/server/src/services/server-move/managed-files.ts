import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isLoopbackHostname } from "@bb/config/loopback";
import {
  bbAppManagedEnvFileSchema,
  formatBbAppConfigPath,
  formatBbAppEnvPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { mutateManagedJsonFile } from "@bb/config/managed-json-file";
import { getAppSettings, type DbConnection } from "@bb/db";
import { z } from "zod";

const managedObjectSchema = z.record(z.string(), z.unknown());
const ENV_PATH_VALUE_PATTERN = /^(?:\/|~\/)/u;

export type ManagedAddressKey = "BB_APP_URL" | "BB_EXTERNAL_URL";

export interface ManagedAddress {
  file: "config.json" | "env.json";
  key: ManagedAddressKey;
  value: string;
}

export interface ServerManagedFiles {
  addresses: ManagedAddress[];
  env: Record<string, string>;
}

export interface EnvPathValue {
  name: string;
  path: string;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeTextAtomically(
  path: string,
  text: string,
): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, text, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export function parseManagedConfigObject(
  path: string,
  text: string | null,
): Record<string, unknown> {
  if (text === null) {
    return {};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}`, { cause: error });
  }
  parseBbAppManagedConfig(raw);
  return managedObjectSchema.parse(raw);
}

async function readManagedConfigObject(
  dataDir: string,
): Promise<Record<string, unknown> | null> {
  const path = formatBbAppConfigPath(dataDir);
  try {
    return parseManagedConfigObject(path, await readOptionalText(path));
  } catch {
    return null;
  }
}

async function readManagedEnv(
  dataDir: string,
): Promise<Record<string, string> | null> {
  const path = formatBbAppEnvPath(dataDir);
  try {
    const text = await readOptionalText(path);
    if (text === null) {
      return {};
    }
    return bbAppManagedEnvFileSchema.parse(JSON.parse(text)).env ?? {};
  } catch {
    return null;
  }
}

function configAppUrl(config: Record<string, unknown> | null): string | null {
  const values = config?.config;
  if (values === null || typeof values !== "object") {
    return null;
  }
  const parsed = z
    .object({ BB_APP_URL: z.string().min(1).optional() })
    .passthrough()
    .safeParse(values);
  return parsed.success ? (parsed.data.BB_APP_URL ?? null) : null;
}

export async function readServerManagedFiles(
  dataDir: string,
): Promise<ServerManagedFiles> {
  const config = await readManagedConfigObject(dataDir);
  const env = (await readManagedEnv(dataDir)) ?? {};
  const addresses: ManagedAddress[] = [];
  const appUrl = configAppUrl(config);
  if (appUrl !== null) {
    addresses.push({ file: "config.json", key: "BB_APP_URL", value: appUrl });
  }
  const externalUrl = env.BB_EXTERNAL_URL;
  if (externalUrl !== undefined && externalUrl.length > 0) {
    addresses.push({
      file: "env.json",
      key: "BB_EXTERNAL_URL",
      value: externalUrl,
    });
  }
  return { addresses, env };
}

export function listEnvPathValues(env: Record<string, string>): EnvPathValue[] {
  return Object.entries(env)
    .filter(([, value]) => ENV_PATH_VALUE_PATTERN.test(value))
    .map(([name, path]) => ({ name, path }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function parseHttpUrl(value: string | null): URL | null {
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function isLoopbackUrl(url: URL): boolean {
  return isLoopbackHostname(url.hostname);
}

export function oldServerAddress(
  db: DbConnection,
  managed: ServerManagedFiles,
): URL | null {
  return parseHttpUrl(
    getAppSettings(db).machineServerUrl ?? managed.env.BB_EXTERNAL_URL ?? null,
  );
}

function originMatches(value: string | null, origin: string): boolean {
  return parseHttpUrl(value)?.origin === origin;
}

export async function rewriteManagedAddresses(args: {
  dataDir: string;
  fromOrigin: string;
  toUrl: string;
}): Promise<ManagedAddressKey[]> {
  const rewritten: ManagedAddressKey[] = [];
  const configPath = formatBbAppConfigPath(args.dataDir);
  const readConfig = async () =>
    parseManagedConfigObject(configPath, await readOptionalText(configPath));
  if (originMatches(configAppUrl(await readConfig()), args.fromOrigin)) {
    await mutateManagedJsonFile({
      path: configPath,
      read: readConfig,
      mutate: (config) => {
        if (!originMatches(configAppUrl(config), args.fromOrigin)) {
          return config;
        }
        const next = {
          ...config,
          config: {
            ...managedObjectSchema.parse(config.config),
            BB_APP_URL: args.toUrl,
          },
        };
        parseBbAppManagedConfig(next);
        rewritten.push("BB_APP_URL");
        return next;
      },
    });
  }
  const envPath = formatBbAppEnvPath(args.dataDir);
  const readEnvFile = async () => {
    const text = await readOptionalText(envPath);
    return bbAppManagedEnvFileSchema.parse(
      text === null ? {} : JSON.parse(text),
    );
  };
  const envFile = await readEnvFile();
  if (originMatches(envFile.env?.BB_EXTERNAL_URL ?? null, args.fromOrigin)) {
    await mutateManagedJsonFile({
      path: envPath,
      read: readEnvFile,
      mutate: (current) => {
        if (
          !originMatches(current.env?.BB_EXTERNAL_URL ?? null, args.fromOrigin)
        ) {
          return current;
        }
        rewritten.push("BB_EXTERNAL_URL");
        return {
          ...current,
          env: { ...current.env, BB_EXTERNAL_URL: args.toUrl },
        };
      },
    });
  }
  return rewritten;
}
