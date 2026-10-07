import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  defaultPreferences,
  describePreference,
  getPreferenceDefault,
  isPreferenceKey,
  organizationModeSchema,
  parsePreferenceValue,
  parseStoredPreferenceValue,
  PREFERENCE_KEYS,
  PREFERENCES_CHANGED_CHANNEL,
  preferenceDefinitions,
  type PreferenceKey,
  type PreferenceValue,
  type PreferenceValues,
} from "./shared/preferences.js";

const PREFERENCE_KV_PREFIX = "preference:";
const MIGRATION_KV_KEY = "migration:ui-preferences:v1";
const CORE_MIGRATION_KV_KEY = "migration:core-ui-preferences:v2";

const CORE_UI_PREFERENCE_KEYS = {
  organizationMode: "sidebar.organizationMode",
  manualSectionOrder: "sidebar.manualSectionOrder",
} as const;
type CoreStoredPreferenceKey = keyof typeof CORE_UI_PREFERENCE_KEYS;
export const CORE_STORED_PREFERENCE_KEYS = Object.keys(
  CORE_UI_PREFERENCE_KEYS,
) as CoreStoredPreferenceKey[];

function isCoreStoredPreferenceKey(
  key: PreferenceKey,
): key is CoreStoredPreferenceKey {
  return Object.hasOwn(CORE_UI_PREFERENCE_KEYS, key);
}

type UiPreferenceEntries = Awaited<
  ReturnType<BbPluginApi["sdk"]["system"]["uiPreferences"]["list"]>
>["preferences"];

async function readCoreEntries(
  bb: BbPluginApi,
): Promise<UiPreferenceEntries | null> {
  try {
    return (await bb.sdk.system.uiPreferences.list()).preferences;
  } catch (error) {
    bb.log.warn(
      `could not read bb's sidebar preferences: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function readCoreValue<Key extends CoreStoredPreferenceKey>(
  bb: BbPluginApi,
  entries: UiPreferenceEntries | null,
  key: Key,
): PreferenceValue<Key> {
  const entry = entries?.[CORE_UI_PREFERENCE_KEYS[key]];
  if (entry === undefined) return getPreferenceDefault(key);
  const parsed = parsePreferenceValue(key, entry.value);
  if (parsed.success) return parsed.value;
  bb.log.warn(
    `bb's ${CORE_UI_PREFERENCE_KEYS[key]} is invalid for ${key} (${parsed.message}); using the default`,
  );
  return getPreferenceDefault(key);
}

async function writeCoreValue(
  bb: BbPluginApi,
  key: CoreStoredPreferenceKey,
  value: unknown,
): Promise<void> {
  const entries = (await bb.sdk.system.uiPreferences.list()).preferences;
  const coreKey = CORE_UI_PREFERENCE_KEYS[key];
  const expectedRevision = entries[coreKey]?.revision ?? 0;
  switch (key) {
    case "organizationMode":
      await bb.sdk.system.uiPreferences.set({
        key: "sidebar.organizationMode",
        value: organizationModeSchema.parse(value),
        expectedRevision,
      });
      return;
    case "manualSectionOrder":
      await bb.sdk.system.uiPreferences.set({
        key: "sidebar.manualSectionOrder",
        value: preferenceDefinitions.manualSectionOrder.schema.parse(value),
        expectedRevision,
      });
      return;
  }
}

const preferenceKeySchema = z.enum(
  PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]],
);

const preferenceValuesSchema = z.object(
  Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, preferenceDefinitions[key].schema]),
  ) as { [Key in PreferenceKey]: (typeof preferenceDefinitions)[Key]["schema"] },
);

export const threadListRpcContract = defineRpcContract({
  listPreferences: {
    input: z.null(),
    output: z.object({ preferences: preferenceValuesSchema }).strict(),
  },
  setPreference: {
    input: z.object({ key: preferenceKeySchema, value: z.unknown() }).strict(),
    output: z
      .object({ key: preferenceKeySchema, value: z.unknown() })
      .strict(),
  },
  resetPreference: {
    input: z.object({ key: preferenceKeySchema }).strict(),
    output: z
      .object({ key: preferenceKeySchema, value: z.unknown() })
      .strict(),
  },
});

function kvKey(key: PreferenceKey): string {
  return `${PREFERENCE_KV_PREFIX}${key}`;
}

export function createPreferenceStore(bb: BbPluginApi) {
  async function readStored<Key extends PreferenceKey>(
    key: Key,
  ): Promise<PreferenceValue<Key>> {
    const stored = await bb.storage.kv.get<unknown>(kvKey(key));
    if (stored === undefined) return getPreferenceDefault(key);
    const parsed = parseStoredPreferenceValue(key, stored);
    if (parsed.success) return parsed.value;
    bb.log.warn(
      `stored preference ${key} is invalid (${parsed.message}); using the default`,
    );
    return getPreferenceDefault(key);
  }

  async function read<Key extends PreferenceKey>(
    key: Key,
  ): Promise<PreferenceValue<Key>> {
    if (isCoreStoredPreferenceKey(key)) {
      const value: PreferenceValue<CoreStoredPreferenceKey> = readCoreValue(
        bb,
        await readCoreEntries(bb),
        key,
      );
      return value as PreferenceValue<Key>;
    }
    return readStored(key);
  }

  async function readAll(): Promise<PreferenceValues> {
    const values = defaultPreferences();
    const coreEntries = await readCoreEntries(bb);
    await Promise.all(
      PREFERENCE_KEYS.map(async (key) => {
        (values as Record<PreferenceKey, unknown>)[key] =
          isCoreStoredPreferenceKey(key)
            ? readCoreValue(bb, coreEntries, key)
            : await readStored(key);
      }),
    );
    return values;
  }

  async function write<Key extends PreferenceKey>(
    key: Key,
    value: unknown,
  ): Promise<PreferenceValue<Key>> {
    const parsed = parsePreferenceValue(key, value);
    if (!parsed.success) {
      throw new PreferenceValidationError(key, parsed.message);
    }
    if (isCoreStoredPreferenceKey(key)) {
      await writeCoreValue(bb, key, parsed.value);
    } else {
      await bb.storage.kv.set(kvKey(key), parsed.value);
    }
    bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, {
      key,
      value: parsed.value,
    });
    return parsed.value;
  }

  async function reset<Key extends PreferenceKey>(
    key: Key,
  ): Promise<PreferenceValue<Key>> {
    if (isCoreStoredPreferenceKey(key)) {
      await bb.sdk.system.uiPreferences.reset({
        key: CORE_UI_PREFERENCE_KEYS[key],
      });
    } else {
      await bb.storage.kv.delete(kvKey(key));
    }
    const value = getPreferenceDefault(key);
    bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, { key, value });
    return value;
  }

  return { read, readAll, write, reset };
}

export class PreferenceValidationError extends Error {
  constructor(
    readonly key: PreferenceKey,
    readonly detail: string,
  ) {
    super(`Invalid value for ${key}: ${detail}`);
    this.name = "PreferenceValidationError";
  }
}

export async function migrateFromUiPreferences(
  bb: BbPluginApi,
): Promise<{ migrated: PreferenceKey[] }> {
  const done = await bb.storage.kv.get<boolean>(MIGRATION_KV_KEY);
  if (done === true) return { migrated: [] };
  const migrated: PreferenceKey[] = [];
  let entries: Record<string, { value: unknown } | undefined>;
  try {
    const response = await bb.sdk.system.uiPreferences.list();
    entries = response.preferences as Record<
      string,
      { value: unknown } | undefined
    >;
  } catch (error) {
    bb.log.warn(
      `could not read bb's sidebar preferences to migrate them: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { migrated };
  }
  for (const key of PREFERENCE_KEYS) {
    if (isCoreStoredPreferenceKey(key)) continue;
    const existing = await bb.storage.kv.get<unknown>(kvKey(key));
    if (existing !== undefined) continue;
    const legacyKey = preferenceDefinitions[key].legacyKey;
    if (legacyKey === null) continue;
    const legacy = entries[legacyKey];
    if (legacy === undefined) continue;
    const parsed = parsePreferenceValue(key, legacy.value);
    if (!parsed.success) continue;
    if (JSON.stringify(parsed.value) === JSON.stringify(getPreferenceDefault(key))) {
      continue;
    }
    await bb.storage.kv.set(kvKey(key), parsed.value);
    migrated.push(key);
  }
  await bb.storage.kv.set(MIGRATION_KV_KEY, true);
  return { migrated };
}

export async function migrateToUiPreferences(
  bb: BbPluginApi,
): Promise<{ migrated: PreferenceKey[] }> {
  const done = await bb.storage.kv.get<boolean>(CORE_MIGRATION_KV_KEY);
  if (done === true) return { migrated: [] };
  const migrated: PreferenceKey[] = [];
  for (const key of CORE_STORED_PREFERENCE_KEYS) {
    const stored = await bb.storage.kv.get<unknown>(kvKey(key));
    if (stored === undefined) continue;
    const parsed = parseStoredPreferenceValue(key, stored);
    if (parsed.success) {
      try {
        await writeCoreValue(bb, key, parsed.value);
        migrated.push(key);
      } catch (error) {
        bb.log.warn(
          `could not move ${key} into bb's sidebar preferences: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { migrated };
      }
    }
    await bb.storage.kv.delete(kvKey(key));
  }
  await bb.storage.kv.set(CORE_MIGRATION_KV_KEY, true);
  return { migrated };
}

function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function requireCliPreferenceKey(raw: string): PreferenceKey {
  if (isPreferenceKey(raw)) return raw;
  throw new PluginCliError(`Unknown preference: ${raw}`, {
    code: "unknown_preference",
    hint: `Known preferences: ${PREFERENCE_KEYS.join(", ")}.`,
  });
}

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

export default async function threadListPlugin(bb: BbPluginApi) {
  const store = createPreferenceStore(bb);

  bb.rpc.register(threadListRpcContract, {
    async listPreferences() {
      return { preferences: await store.readAll() };
    },
    async setPreference({ key, value }) {
      return { key, value: await store.write(key, value) };
    },
    async resetPreference({ key }) {
      return { key, value: await store.reset(key) };
    },
  });

  bb.cli.register(
    defineCli({
      name: bb.pluginId,
      summary: "Inspect and change the sidebar thread list's layout preferences",
      description:
        "Organization mode, sort, section order, hidden groups, and collapsed groups for bb's sidebar thread list. Values are JSON; a bare word is read as a string.",
      commands: {
        "prefs list": cliCommand({
          summary: "List every preference and its current value",
          options: { json: JSON_OPTION },
          async run(input) {
            const values = await store.readAll();
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify(values) };
            }
            return {
              exitCode: 0,
              stdout: PREFERENCE_KEYS.map(
                (key) =>
                  `${key}\t${JSON.stringify(values[key])}\t${describePreference(key)}`,
              ).join("\n"),
            };
          },
        }),
        "prefs get": cliCommand({
          summary: "Print one preference",
          positionals: [
            { name: "key", description: "Preference name", required: true },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const key = requireCliPreferenceKey(input.positionals.key);
            const value = await store.read(key);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ key, value })
                : JSON.stringify(value),
            };
          },
        }),
        "prefs set": cliCommand({
          summary: "Set one preference",
          positionals: [
            { name: "key", description: "Preference name", required: true },
            {
              name: "value",
              description: 'JSON value, e.g. \'"machine"\' or \'["pinned","threads"]\'',
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const key = requireCliPreferenceKey(input.positionals.key);
            try {
              const value = await store.write(
                key,
                parseCliValue(input.positionals.value),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ key, value })
                  : `${key} = ${JSON.stringify(value)}`,
              };
            } catch (error) {
              if (error instanceof PreferenceValidationError) {
                throw new PluginCliError(error.message, {
                  code: "invalid_preference_value",
                  hint: describePreference(key),
                });
              }
              throw error;
            }
          },
        }),
        "prefs reset": cliCommand({
          summary: "Restore one preference to its default",
          positionals: [
            { name: "key", description: "Preference name", required: true },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const key = requireCliPreferenceKey(input.positionals.key);
            const value = await store.reset(key);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ key, value })
                : `${key} = ${JSON.stringify(value)}`,
            };
          },
        }),
      },
    }),
  );

  const { migrated } = await migrateFromUiPreferences(bb);
  if (migrated.length > 0) {
    bb.log.info(
      `migrated sidebar preferences from bb settings: ${migrated.join(", ")}`,
    );
  }
  const { migrated: movedToCore } = await migrateToUiPreferences(bb);
  if (movedToCore.length > 0) {
    bb.log.info(
      `moved sidebar preferences into bb settings: ${movedToCore.join(", ")}`,
    );
  }
}
