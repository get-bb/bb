import type { AppTheme } from "@bb/domain";
import type { CreateSdkAreaArgs } from "./common.js";

export interface ThemeArea {
  /** The active app palette (built-in id or custom CSS). */
  get(): Promise<AppTheme>;
  /** Set the active app palette; broadcasts to all open windows. */
  set(input: AppTheme): Promise<AppTheme>;
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
    async set(input) {
      return transport.readJson(
        transport.api.v1.settings.appearance.$put({ json: input }),
      );
    },
  };
}
