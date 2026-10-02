import type { AppTheme, AppThemeSelection, CustomThemeWrite } from "@bb/domain";
import type {
  CustomThemeWriteResult,
  ThemeCatalogResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type ThemeGetResult = AppTheme;
export type ThemeCatalogResult = ThemeCatalogResponse;
export type ThemeSetInput = AppThemeSelection;
export type ThemeSetResult = AppTheme;
export type ThemeResolveResult = AppTheme;
export type ThemeWriteInput = CustomThemeWrite;
export type ThemeWriteResult = CustomThemeWriteResult;

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
  create(input: ThemeWriteInput): Promise<ThemeWriteResult>;
  update(input: ThemeWriteInput): Promise<ThemeWriteResult>;
  remove(themeId: string): Promise<ThemeCatalogResult>;
}

export function createThemeArea(args: CreateSdkAreaArgs): ThemeArea {
  const { transport } = args;
  return {
    async get(input = {}) {
      const config = await transport.readJson(
        transport.api.v1.system.config.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
      return config.appearance;
    },
    async catalog(input = {}) {
      return transport.readJson(
        transport.api.v1.settings.themes.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async resolve(input) {
      return transport.readJson(
        transport.api.v1.settings.themes[":id"].$get(
          { param: { id: input.themeId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async set(input) {
      if (typeof input === "string") {
        const appearance = (
          await transport.readJson(transport.api.v1.system.config.$get())
        ).appearance;
        return transport.readJson(
          transport.api.v1.settings.appearance.$put({
            json: {
              themeId: input,
              faviconColor: appearance.faviconColor,
            },
          }),
        );
      }
      return transport.readJson(
        transport.api.v1.settings.appearance.$put({ json: input }),
      );
    },
    async create(input) {
      return transport.readJson(
        transport.api.v1.settings.themes.$post({ json: input }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.settings.themes.$post({ json: input }),
      );
    },
    async remove(themeId) {
      return transport.readJson(
        transport.api.v1.settings.themes[":id"].$delete({
          param: { id: themeId },
        }),
      );
    },
  };
}
