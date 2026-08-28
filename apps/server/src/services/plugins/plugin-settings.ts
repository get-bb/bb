import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "@bb/domain";
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
import { validateSettingsUpdate } from "@get-bb/plugin-sdk/internal/host-policy";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";

const { readFile, stat } = process.getBuiltinModule("node:fs/promises");

interface PluginSettingsValues {
  [key: string]: PluginSettingValue | undefined;
}

interface PluginSettingsViewValues {
  [key: string]: PluginSettingValue | { set: boolean };
}

interface PluginSettingsUpdateValues {
  [key: string]: JsonValue;
}

export { validateSettingsUpdate as validatePluginSettingsUpdate };

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

interface PluginSettingsStoreArgs {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  descriptors: PluginSettingDescriptors;
}

function parseStoredSettingValue(
  descriptor: PluginSettingDescriptor,
  raw: string | undefined,
): PluginSettingValue | undefined {
  if (raw === undefined) return descriptor.default;
  let parsedValue: PluginSettingValue;
  try {
    const parsed = (
      descriptor.type === "boolean" ? z.boolean() : z.string()
    ).safeParse(JSON.parse(raw));
    if (!parsed.success) return descriptor.default;
    parsedValue = parsed.data;
  } catch {
    return descriptor.default;
  }
  if (descriptor.type === "select") {
    const selected = z.string().safeParse(parsedValue);
    if (!selected.success || !descriptor.options.includes(selected.data)) {
      return descriptor.default;
    }
    return selected.data;
  }
  return parsedValue;
}

export function readPluginSettingsValuesSync(
  args: Omit<PluginSettingsStoreArgs, "dataDir">,
): PluginSettingsValues {
  const stored = getPluginSettingsValues(args.db, args.pluginId);
  const values: PluginSettingsValues = {};
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    if (isSecret(descriptor)) continue;
    values[key] = parseStoredSettingValue(descriptor, stored[key]);
  }
  return values;
}

export async function readPluginSettingsValues(
  args: PluginSettingsStoreArgs,
): Promise<PluginSettingsValues> {
  const values = readPluginSettingsValuesSync(args);
  for (const [key, descriptor] of Object.entries(args.descriptors)) {
    if (!isSecret(descriptor)) continue;
    values[key] =
      (await readSecret(args.dataDir, args.pluginId, key)) ??
      descriptor.default;
  }
  return values;
}

export async function writePluginSettingsUpdate(
  args: PluginSettingsStoreArgs & { values: PluginSettingsUpdateValues },
): Promise<void> {
  const rowUpdates: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(args.values)) {
    const descriptor = args.descriptors[key];
    if (!descriptor) continue;
    if (isSecret(descriptor)) {
      const path = secretFilePath(args.dataDir, args.pluginId, key);
      if (value === null) await deleteSecretFile(path);
      else await writeSecretFile(path, z.string().parse(value));
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
  values: PluginSettingsViewValues;
}

export async function buildPluginSettingsView(
  args: PluginSettingsStoreArgs,
): Promise<PluginSettingsView> {
  const effective = await readPluginSettingsValues(args);
  const values: PluginSettingsViewValues = {};
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
