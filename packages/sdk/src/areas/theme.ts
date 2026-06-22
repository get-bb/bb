import type { AppTheme } from "@bb/domain";
import type { ThemeCatalogResponse } from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface ThemeArea {
  /** The active app palette, resolved server-side (built-in id or custom CSS). */
  get(): Promise<AppTheme>;
  /** The custom-theme directory plus discovered themes and the active palette. */
  catalog(): Promise<ThemeCatalogResponse>;
  /**
   * Activate a palette by id — a built-in id or a custom theme name that exists
   * under `<data-dir>/theme/<name>/theme.css`. Broadcasts to all open windows.
   */
  set(themeId: string): Promise<AppTheme>;
}

export function createThemeArea(args: CreateSdkAreaArgs): ThemeArea {
  const { transport } = args;
  return {
    async get() {
      const config = await transport.readJson(
        transport.api.v1.system.config.$get(),
      );
      return config.appearance;
    },
    async catalog() {
      return transport.readJson(transport.api.v1.settings.themes.$get());
    },
    async set(themeId) {
      return transport.readJson(
        transport.api.v1.settings.appearance.$put({ json: { themeId } }),
      );
    },
  };
}
