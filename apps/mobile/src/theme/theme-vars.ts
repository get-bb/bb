import type { NativeThemeTokens } from "./theme.native";

/** A CSS custom-property name as NativeWind's variable context expects it. */
export type CssVarName = `--${string}`;

/**
 * `theme.native.ts` keys are the camelCase form of the theme.css custom
 * properties (`surfaceRaisedSolid` ← `--surface-raised-solid`,
 * `ansiBgFg10` ← `--ansi-bg-fg-10`). This inverts that mapping so the
 * NativeWind variable context uses the exact web names, which is what
 * `global.css` maps `--color-*` utilities onto.
 */
export function tokenKeyToCssVar(key: string): CssVarName {
  const kebab = key
    .replace(/([A-Z])/g, "-$1")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .toLowerCase();
  return `--${kebab}`;
}

/**
 * Builds the variable map for NativeWind's `VariableContextProvider` from one
 * palette × mode token set. Every token becomes `--<kebab-name>: <color>`.
 */
export function buildThemeVars(
  tokens: NativeThemeTokens,
): Record<CssVarName, string> {
  const vars: Record<CssVarName, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    vars[tokenKeyToCssVar(key)] = value;
  }
  return vars;
}
