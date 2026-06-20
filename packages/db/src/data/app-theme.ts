import { eq } from "drizzle-orm";
import { defaultAppTheme, type AppTheme } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { appTheme } from "../schema.js";

const APP_THEME_ROW_ID = "current";

export function getAppTheme(db: DbConnection): AppTheme {
  const row = db
    .select({
      themeId: appTheme.themeId,
      customCss: appTheme.customCss,
    })
    .from(appTheme)
    .where(eq(appTheme.id, APP_THEME_ROW_ID))
    .get();

  if (!row) return defaultAppTheme;
  // themeId is stored as free text; writes always go through setAppTheme with a
  // validated AppTheme, so narrowing back to the union at this boundary is safe.
  return {
    themeId: row.themeId as AppTheme["themeId"],
    customCss: row.customCss,
  };
}

export function setAppTheme(db: DbConnection, theme: AppTheme): void {
  const updatedAt = Date.now();
  db.insert(appTheme)
    .values({
      id: APP_THEME_ROW_ID,
      themeId: theme.themeId,
      customCss: theme.customCss,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appTheme.id,
      set: {
        themeId: theme.themeId,
        customCss: theme.customCss,
        updatedAt,
      },
    })
    .run();
}
