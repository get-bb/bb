import type { BuiltInThemeId } from "@bb/domain";
import { VariableContextProvider } from "nativewind";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import { FONT_FAMILIES } from "./fonts";
import {
  readThemePreference,
  resolveThemeMode,
  writeThemePreference,
  type ThemeMode,
  type ThemeModePreference,
  type ThemePreferenceStorage,
} from "./theme-preference";
import { createThemePreferenceStorage } from "./theme-storage";
import { buildThemeVars } from "./theme-vars";
import {
  nativeRadii,
  nativeThemes,
  nativeTypography,
  type NativeThemeTokens,
} from "./theme.native";

export interface Theme {
  /** Server-owned palette id (`GET /system/config → appearance.themeId`). */
  palette: BuiltInThemeId;
  /** Effective light/dark mode after resolving the preference. */
  mode: ThemeMode;
  /** The persisted preference (`bb.theme`). */
  preference: ThemeModePreference;
  /** Resolved color tokens for `palette` × `mode`, as RN color strings. */
  tokens: NativeThemeTokens;
  radii: typeof nativeRadii;
  typography: typeof nativeTypography;
  fonts: typeof FONT_FAMILIES;
  setMode: (preference: ThemeModePreference) => void;
}

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Defaults to `default`; the app passes the server's `appearance.themeId`. */
  palette?: BuiltInThemeId;
}

let defaultStorage: ThemePreferenceStorage | null = null;
function getDefaultStorage(): ThemePreferenceStorage {
  defaultStorage ??= createThemePreferenceStorage();
  return defaultStorage;
}

/**
 * Supplies bb's theme to the tree: `useTheme()` for token values in JS and
 * NativeWind CSS variables (`--background`, `--border`, …) so utility classes
 * like `bg-background text-foreground border-border` follow the palette and
 * mode. Also forces RN's own color scheme to the effective mode so `dark:`
 * variants, native alerts, and the keyboard match an explicit preference.
 */
export function ThemeProvider({
  children,
  palette = "default",
}: ThemeProviderProps) {
  const [store] = useState(getDefaultStorage);
  const [preference, setPreference] = useState<ThemeModePreference>(() =>
    readThemePreference(store),
  );
  const systemScheme = useColorScheme();
  const mode = resolveThemeMode(preference, systemScheme);

  useEffect(() => {
    Appearance.setColorScheme(
      preference === "system" ? "unspecified" : preference,
    );
  }, [preference]);

  const setMode = useCallback(
    (next: ThemeModePreference) => {
      writeThemePreference(store, next);
      setPreference(next);
    },
    [store],
  );

  const tokens = nativeThemes[palette][mode];
  const vars = useMemo(() => buildThemeVars(tokens), [tokens]);
  const theme = useMemo<Theme>(
    () => ({
      palette,
      mode,
      preference,
      tokens,
      radii: nativeRadii,
      typography: nativeTypography,
      fonts: FONT_FAMILIES,
      setMode,
    }),
    [palette, mode, preference, tokens, setMode],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <VariableContextProvider value={vars}>{children}</VariableContextProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return theme;
}
