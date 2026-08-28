import type { NativeThemeTokens } from "./theme.native";

export type CssVarName = `--${string}`;
export type ThemeVars = Record<CssVarName, string>;

export function tokenKeyToCssVar(key: string): CssVarName {
  const kebab = key
    .replace(/([A-Z])/g, "-$1")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .toLowerCase();
  return `--${kebab}`;
}

export function buildThemeVars(tokens: NativeThemeTokens) {
  const vars: ThemeVars = {};
  for (const [key, value] of Object.entries(tokens)) {
    vars[tokenKeyToCssVar(key)] = value;
  }
  return vars;
}
