// `useAppFonts` is intentionally not re-exported: importing its module keeps
// the splash screen up until the hook hides it, so import it explicitly from
// "@/theme/useAppFonts" in the root layout only.
export { ThemeProvider, useTheme, type Theme } from "./ThemeProvider";
export { resolveFont, resolveItalicFont } from "./fonts";
export { type ThemeModePreference } from "./theme-preference";
export { scrimBaseColor } from "./scrim";
export { nativeTypography, type NativeThemeTokens } from "./theme.native";
