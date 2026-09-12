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
import { getPreferencesStorage } from "@/lib/native/preferences-storage";
import {
  readThemePreference,
  resolveThemeMode,
  writeThemePreference,
  type ThemeMode,
  type ThemeModePreference,
  type ThemePreferenceStorage,
} from "./theme-preference";
import { buildThemeVars } from "./theme-vars";
import {
  nativeRadii,
  nativeThemes,
  type NativeThemeTokens,
} from "./theme.native";

export interface Theme {
  palette: BuiltInThemeId;
  mode: ThemeMode;
  preference: ThemeModePreference;
  tokens: NativeThemeTokens;
  radii: typeof nativeRadii;
  setMode: (preference: ThemeModePreference) => void;
}

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  palette?: BuiltInThemeId;
}

export function ThemeProvider({
  children,
  palette = "default",
}: ThemeProviderProps) {
  const [store] = useState<ThemePreferenceStorage>(getPreferencesStorage);
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
