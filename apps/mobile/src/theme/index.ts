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
  resolveFont,
  resolveItalicFont,
  type FontFamilyKind,
  type FontWeightName,
  type ResolvedFont,
} from "./fonts";
export {
  type ThemeMode,
  type ThemeModePreference,
  type ThemePreferenceStorage,
} from "./theme-preference";
export { scrimBaseColor } from "./scrim";
export {
  nativeTypography,
  type NativeTextSize,
  type NativeTextStyle,
  type NativeThemeModes,
  type NativeThemeTokens,
} from "./theme.native";
