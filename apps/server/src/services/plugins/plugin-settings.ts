import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  getPluginSettingsValues,
  setPluginSettingsValues,
  type DbConnection,
} from "@bb/db";
import type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@bb/plugin-sdk";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";

// The descriptor types are part of the backend plugin contract in
// @bb/plugin-sdk; re-exported so server code keeps one import site.
export type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
} from "@bb/plugin-sdk";

/** A settings update the routes rejected: unknown key or wrong value type. */
export class PluginSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginSettingsValidationError";
  }
}

// Keys become file names (secrets) and CLI arguments; keep them tame.
const SETTING_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

const baseFields = {
  label: z.string().min(1),
  description: z.string().min(1).optional(),
};

const descriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      ...baseFields,
      secret: z.literal(true).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("boolean"),
      ...baseFields,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      ...baseFields,
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project"),
      ...baseFields,
      default: z.string().optional(),
    })
    .strict(),
]);

/**
 * Validate freeform descriptors from plugin code (jiti-loaded TS is not
 * typechecked at runtime) and merge them into the plugin's registered schema.
 * Throws a human-readable error for the plugin's load-error status.
 */
export function registerSettingDescriptors(
  target: PluginSettingDescriptors,
  added: Record<string, unknown>,
): PluginSettingDescriptors {
  const validated: PluginSettingDescriptors = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" — use letters, digits, "-" and "_"`,
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    const parsed = descriptorSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `invalid descriptor for setting "${key}"${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`,
      );
    }
    const descriptor = parsed.data;
    if (
      descriptor.type === "select" &&
      descriptor.default !== undefined &&
      !descriptor.options.includes(descriptor.default)
    ) {
      throw new Error(
        `default for setting "${key}" must be one of its options`,
      );
    }
    validated[key] = descriptor;
  }
  Object.assign(target, validated);
  return validated;
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
    values[key] = (parsed as PluginSettingValue | undefined) ?? descriptor.default;
  }
  return values;
}

/**
 * Validate a settings update against the declared descriptors. `null` means
 * "unset". Returns error strings (empty when valid).
 */
export function validatePluginSettingsUpdate(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor = descriptors[key];
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue; // unset
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`,
      );
    }
  }
  return errors;
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
