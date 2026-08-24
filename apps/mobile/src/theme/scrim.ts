import type { ThemeMode } from "./theme-preference";
import type { NativeThemeTokens } from "./theme.native";

/**
 * The base color of every dimming overlay (the home compose scrim, sheet
 * backdrops). A scrim must darken what is under it in both modes: `ink` does
 * that in light mode, but dark palettes have a light `ink` (`#cdd6f4`,
 * `#f8f8f2`, …) and an ink scrim washes the screen out to gray. Dark mode
 * therefore dims toward black, which every palette reads as "darker than the
 * canvas". Callers apply their own alpha with `withAlpha`.
 */
export function scrimBaseColor(
  mode: ThemeMode,
  tokens: Pick<NativeThemeTokens, "ink">,
): string {
  return mode === "dark" ? "#000000" : tokens.ink;
}
