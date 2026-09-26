import { eq, inArray } from "drizzle-orm";
import {
  aiServiceSelectionSchema,
  AI_TASKS,
  appKeybindingOverridesSchema,
  appSettingsSchema,
  defaultAiServiceSelections,
  defaultAppSettings,
  type AiServiceSelection,
  type AiServiceSelections,
  type AiTask,
  type AppKeybindingOverrides,
  type AppSettings,
} from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { appSettingsValues } from "../schema.js";

const appSettingsKeySchema = appSettingsSchema.keyof();
const appSettingsKeys = appSettingsKeySchema.options;

const KEYBINDING_OVERRIDES_KEY = "keybindingOverrides";
const AI_SERVICE_SELECTIONS_KEY = "aiServiceSelections";
const PLUGIN_SAFE_MODE_KEY = "pluginSafeMode";
const LEGACY_DIAGNOSTIC_EVENTS_KEY = "showUnhandledProviderEvents";

function parseStoredValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function writeValue(
  db: DbQueryConnection,
  key: string,
  value: unknown,
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
  const values: Record<string, unknown> = { ...defaultAppSettings };
  const rows = db
    .select({ key: appSettingsValues.key, value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(
      inArray(appSettingsValues.key, [
        ...appSettingsKeys,
        LEGACY_DIAGNOSTIC_EVENTS_KEY,
      ]),
    )
    .all();

  const legacyDiagnosticEvents = rows.find(
    (row) => row.key === LEGACY_DIAGNOSTIC_EVENTS_KEY,
  );
  if (legacyDiagnosticEvents) {
    const parsed = appSettingsSchema.shape.showDiagnosticEvents.safeParse(
      parseStoredValue(legacyDiagnosticEvents.value),
    );
    if (parsed.success) values.showDiagnosticEvents = parsed.data;
  }

  for (const row of rows) {
    const key = appSettingsKeySchema.safeParse(row.key);
    if (!key.success) continue;
    const value = appSettingsSchema.shape[key.data].safeParse(
      parseStoredValue(row.value),
    );
    if (value.success) values[key.data] = value.data;
  }

  return appSettingsSchema.parse(values);
}

export function setAppSettings(db: DbConnection, settings: AppSettings): void {
  const updatedAt = Date.now();
  db.transaction((transaction) => {
    for (const key of appSettingsKeys) {
      writeValue(transaction, key, settings[key], updatedAt);
    }
    transaction
      .delete(appSettingsValues)
      .where(eq(appSettingsValues.key, LEGACY_DIAGNOSTIC_EVENTS_KEY))
      .run();
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

export function getAiServiceSelections(db: DbConnection): AiServiceSelections {
  const row = db
    .select({ value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(eq(appSettingsValues.key, AI_SERVICE_SELECTIONS_KEY))
    .get();
  const stored: unknown =
    row === undefined ? undefined : parseStoredValue(row.value);
  const selections: AiServiceSelections = { ...defaultAiServiceSelections };
  if (typeof stored !== "object" || stored === null) return selections;
  for (const task of AI_TASKS) {
    const parsed = aiServiceSelectionSchema.safeParse(Reflect.get(stored, task));
    if (parsed.success) selections[task] = parsed.data;
  }
  return selections;
}

export function setAiServiceSelection(
  db: DbConnection,
  task: AiTask,
  selection: AiServiceSelection,
): AiServiceSelections {
  const selections = { ...getAiServiceSelections(db), [task]: selection };
  writeValue(db, AI_SERVICE_SELECTIONS_KEY, selections, Date.now());
  return selections;
}

export function getPluginSafeMode(db: DbConnection): boolean {
  const row = db
    .select({ value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(eq(appSettingsValues.key, PLUGIN_SAFE_MODE_KEY))
    .get();
  return row !== undefined && parseStoredValue(row.value) === true;
}

export function setPluginSafeMode(db: DbConnection, enabled: boolean): void {
  writeValue(db, PLUGIN_SAFE_MODE_KEY, enabled, Date.now());
}
