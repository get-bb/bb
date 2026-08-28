import { eq, inArray } from "drizzle-orm";
import {
  appKeybindingOverridesSchema,
  appSettingsSchema,
  defaultAppSettings,
  jsonValueSchema,
  type JsonValue,
  type AppKeybindingOverrides,
  type AppSettings,
} from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { appSettingsValues } from "../schema.js";

const appSettingsKeySchema = appSettingsSchema.keyof();
const appSettingsKeys = appSettingsKeySchema.options;

const KEYBINDING_OVERRIDES_KEY = "keybindingOverrides";

function parseStoredValue(text: string): JsonValue | undefined {
  try {
    return jsonValueSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function writeValue(
  db: DbQueryConnection,
  key: string,
  value: JsonValue,
  updatedAt: number,
): void {
  const text = JSON.stringify(value);
  db.insert(appSettingsValues)
    .values({ key, value: text, updatedAt })
    .onConflictDoUpdate({
      target: appSettingsValues.key,
      set: { value: text, updatedAt },
    })
    .run();
}

export function getAppSettings(db: DbConnection): AppSettings {
  let values: AppSettings = { ...defaultAppSettings };
  const rows = db
    .select({ key: appSettingsValues.key, value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(inArray(appSettingsValues.key, [...appSettingsKeys]))
    .all();

  for (const row of rows) {
    const key = appSettingsKeySchema.safeParse(row.key);
    if (!key.success) continue;
    const storedValue = parseStoredValue(row.value);
    if (storedValue === undefined) continue;
    const parsed = appSettingsSchema.safeParse({
      ...values,
      [key.data]: storedValue,
    });
    if (parsed.success) values = parsed.data;
  }

  return appSettingsSchema.parse(values);
}

export function setAppSettings(db: DbConnection, settings: AppSettings): void {
  const updatedAt = Date.now();
  db.transaction((transaction) => {
    for (const key of appSettingsKeys) {
      writeValue(transaction, key, settings[key], updatedAt);
    }
  });
}

export function getAppKeybindingOverrides(
  db: DbConnection,
): AppKeybindingOverrides {
  const row = db
    .select({ value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(eq(appSettingsValues.key, KEYBINDING_OVERRIDES_KEY))
    .get();

  if (row === undefined) {
    return [];
  }
  return appKeybindingOverridesSchema.parse(parseStoredValue(row.value));
}

export function setAppKeybindingOverrides(
  db: DbConnection,
  overrides: AppKeybindingOverrides,
): void {
  writeValue(db, KEYBINDING_OVERRIDES_KEY, overrides, Date.now());
}
