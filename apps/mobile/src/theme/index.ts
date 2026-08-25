// Fonts are the platform system faces (see fonts.ts / font-platform*.ts);
// nothing is loaded at runtime, so the root layout gates the splash on
// `useAppBoot` alone.
export { ThemeProvider, useTheme, type Theme } from "./ThemeProvider";
export { resolveFont, resolveItalicFont, type ResolvedFont } from "./fonts";
export { type ThemeModePreference } from "./theme-preference";
export { scrimBaseColor } from "./scrim";
export { nativeTypography, type NativeThemeTokens } from "./theme.native";
