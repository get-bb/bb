import type { AppTheme, AppThemeSelection } from "@bb/domain";
import type { ThemeCatalogResponse } from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type ThemeGetResult = AppTheme;
export type ThemeCatalogResult = ThemeCatalogResponse;
export type ThemeSetInput = AppThemeSelection;
export type ThemeSetResult = AppTheme;
export type ThemeResolveResult = AppTheme;

export interface ThemeCatalogArgs {
  signal?: AbortSignal;
}

export interface ThemeGetArgs {
  signal?: AbortSignal;
}

export interface ThemeResolveArgs {
  themeId: string;
  signal?: AbortSignal;
}

export interface ThemeArea {
  get(args?: ThemeGetArgs): Promise<ThemeGetResult>;
  catalog(args?: ThemeCatalogArgs): Promise<ThemeCatalogResult>;
  resolve(args: ThemeResolveArgs): Promise<ThemeResolveResult>;
  set(selection: ThemeSetInput): Promise<ThemeSetResult>;
  set(themeId: string): Promise<ThemeSetResult>;
}

export function createThemeArea(args: CreateSdkAreaArgs): ThemeArea {
  const { call } = args.operations;
  return {
    async get(input = {}) {
      const config = await call("system.config", {}, input.signal);
      return config.appearance;
    },
    catalog: (input = {}) => call("system.themes", {}, input.signal),
    resolve: ({ themeId, signal }) =>
      call("system.resolveTheme", { id: themeId }, signal),
    async set(input) {
      if (typeof input === "string") {
        const { appearance } = await call("system.config", {});
        return call("system.appearance", {
          themeId: input,
          faviconColor: appearance.faviconColor,
        });
      }
      return call("system.appearance", input);
    },
  };
}
