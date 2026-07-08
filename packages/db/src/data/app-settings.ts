import { eq } from "drizzle-orm";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { appSettings } from "../schema.js";

const APP_SETTINGS_ROW_ID = "current";

export function getAppSettings(db: DbConnection): AppSettings {
  const row = db
    .select({ caffeinate: appSettings.caffeinate })
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID))
    .get();

  return row ?? defaultAppSettings;
}

export function setAppSettings(
  db: DbConnection,
  settings: AppSettings,
): void {
  const updatedAt = Date.now();
  db.insert(appSettings)
    .values({
      id: APP_SETTINGS_ROW_ID,
      caffeinate: settings.caffeinate,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        caffeinate: settings.caffeinate,
        updatedAt,
      },
    })
    .run();
}
