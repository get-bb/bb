// `useAppFonts` is intentionally not re-exported: importing its module keeps
// the splash screen up until the hook hides it, so import it explicitly from
// "@/theme/useAppFonts" in the root layout only.
export {
  ThemeProvider,
  useTheme,
  type Theme,
  type ThemeProviderProps,
} from "./ThemeProvider";
export {
  FONT_FAMILIES,
  FONT_WEIGHT_VALUES,
  ITALIC_FONT_FAMILIES,
  resolveFont,
  resolveItalicFont,
  type FontFamilyKind,
  type FontWeightName,
  type ResolvedFont,
} from "./fonts";
export {
  parseThemePreference,
  resolveThemeMode,
  THEME_PREFERENCE_STORAGE_KEY,
  type ThemeMode,
  type ThemeModePreference,
  type ThemePreferenceStorage,
} from "./theme-preference";
export { scrimBaseColor } from "./scrim";
export { buildThemeVars, tokenKeyToCssVar } from "./theme-vars";
export {
  nativeRadii,
  nativeThemes,
  nativeTypography,
  type NativeTextSize,
  type NativeTextStyle,
  type NativeThemeModes,
  type NativeThemeTokens,
} from "./theme.native";
