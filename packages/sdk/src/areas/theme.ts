import type { AppTheme, AppThemeSelection } from "@bb/domain";
import type { ThemeCatalogResponse } from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type ThemeGetResult = AppTheme;
export type ThemeCatalogResult = ThemeCatalogResponse;
export type ThemeSetInput = AppThemeSelection;
export type ThemeSetResult = AppTheme;

export interface ThemeArea {
  /** The active app palette, resolved server-side (built-in id or custom CSS). */
  get(): Promise<ThemeGetResult>;
  /** The custom-theme directory plus discovered themes and the active palette. */
  catalog(): Promise<ThemeCatalogResult>;
  /** Set the complete app appearance selection in one request. */
  set(selection: ThemeSetInput): Promise<ThemeSetResult>;
  /**
   * Activate a palette by id while preserving the active favicon color. This
   * compatibility shorthand reads the active appearance before writing the
   * complete selection; prefer the object form when both values are known.
   */
  set(themeId: string): Promise<ThemeSetResult>;
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
    async set(input) {
      const selection =
        typeof input === "string"
          ? {
              themeId: input,
              faviconColor: (
                await transport.readJson(transport.api.v1.system.config.$get())
              ).appearance.faviconColor,
            }
          : input;
      return transport.readJson(
        transport.api.v1.settings.appearance.$put({ json: selection }),
      );
    },
  };
}
