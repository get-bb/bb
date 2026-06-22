import { eq } from "drizzle-orm";
import { defaultAppTheme } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { appTheme } from "../schema.js";

const APP_THEME_ROW_ID = "current";

/**
 * The persisted active palette id (built-in id or custom theme name). The CSS
 * for a custom theme is resolved from disk by the server, not stored here.
 */
export function getStoredThemeId(db: DbConnection): string {
  const row = db
    .select({ themeId: appTheme.themeId })
    .from(appTheme)
    .where(eq(appTheme.id, APP_THEME_ROW_ID))
    .get();

  return row?.themeId ?? defaultAppTheme.themeId;
}

export function setStoredThemeId(db: DbConnection, themeId: string): void {
  const updatedAt = Date.now();
  db.insert(appTheme)
    .values({ id: APP_THEME_ROW_ID, themeId, updatedAt })
    .onConflictDoUpdate({
      target: appTheme.id,
      set: { themeId, updatedAt },
    })
    .run();
}
