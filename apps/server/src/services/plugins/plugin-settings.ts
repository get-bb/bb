import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getPluginSettingsValues,
  setPluginSettingsValues,
  type DbConnection,
} from "@bb/db";
import type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@get-bb/plugin-sdk";
import {
  registerSettingDescriptors,
  validateSettingsUpdate,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";

export {
  registerSettingDescriptors,
  validateSettingsUpdate as validatePluginSettingsUpdate,
};

// The descriptor types are part of the backend plugin contract in
// @get-bb/plugin-sdk; re-exported so server code keeps one import site.
export type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@get-bb/plugin-sdk";

/** A settings update the routes rejected: unknown key or wrong value type. */
export class PluginSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginSettingsValidationError";
  }
}

export function pluginSecretsDir(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId, "secrets");
}

function secretFilePath(
  dataDir: string,
  pluginId: string,
  key: string,
): string {
  return join(pluginSecretsDir(dataDir, pluginId), key);
}

function isSecret(descriptor: PluginSettingDescriptor): boolean {
  return descriptor.type === "string" && descriptor.secret === true;
}

async function readSecret(
  dataDir: string,
  pluginId: string,
  key: string,
): Promise<string | undefined> {
  try {
    return await readFile(secretFilePath(dataDir, pluginId, key), "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

export interface PluginSettingsStoreArgs {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  descriptors: PluginSettingDescriptors;
}

/** Effective typed values: stored value when valid, else the default, else undefined. */
export async function readPluginSettingsValues(
  args: PluginSettingsStoreArgs,
): Promise<Record<string, PluginSettingValue | undefined>> {
  const stored = getPluginSettingsValues(args.db, args.pluginId);
  const values: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    if (isSecret(descriptor)) {
      values[key] =
        (await readSecret(args.dataDir, args.pluginId, key)) ??
        descriptor.default;
      continue;
    }
    const raw = stored[key];
    let parsed: unknown;
    if (raw !== undefined) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }
    const expected = descriptor.type === "boolean" ? "boolean" : "string";
    if (typeof parsed !== expected) parsed = undefined;
    if (
      descriptor.type === "select" &&
      typeof parsed === "string" &&
      !descriptor.options.includes(parsed)
    ) {
      parsed = undefined;
    }
    values[key] =
      (parsed as PluginSettingValue | undefined) ?? descriptor.default;
  }
  return values;
}

/** Persist a pre-validated update: secrets to files, the rest to plugin_settings. */
export async function writePluginSettingsUpdate(
  args: PluginSettingsStoreArgs & { values: Record<string, unknown> },
): Promise<void> {
  const rowUpdates: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(args.values)) {
    const descriptor = args.descriptors[key];
    if (!descriptor) continue;
    if (isSecret(descriptor)) {
      const path = secretFilePath(args.dataDir, args.pluginId, key);
      if (value === null) await deleteSecretFile(path);
      else await writeSecretFile(path, value as string);
      continue;
    }
    rowUpdates[key] = value === null ? null : JSON.stringify(value);
  }
  if (Object.keys(rowUpdates).length > 0) {
    setPluginSettingsValues(args.db, args.pluginId, rowUpdates);
  }
}

export interface PluginSettingsView {
  schema: PluginSettingDescriptors;
  /** Effective non-secret values; secret keys map to `{ set: boolean }`. */
  values: Record<string, unknown>;
}

export async function buildPluginSettingsView(
  args: PluginSettingsStoreArgs,
): Promise<PluginSettingsView> {
  const effective = await readPluginSettingsValues(args);
  const values: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    if (isSecret(descriptor)) {
      values[key] = {
        set: await stat(secretFilePath(args.dataDir, args.pluginId, key))
          .then(() => true)
          .catch(() => false),
      };
    } else if (effective[key] !== undefined) {
      values[key] = effective[key];
    }
  }
  return { schema: args.descriptors, values };
}
