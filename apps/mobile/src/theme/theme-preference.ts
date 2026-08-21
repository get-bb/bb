/**
 * Light/dark mode preference. Mirrors the web app's `bb.theme` localStorage
 * key (`apps/app/src/hooks/useTheme.ts`): the value is `light`, `dark`, or
 * `system`, and it is client-local (never server state). The palette id is
 * a separate axis owned by the server (`GET /system/config`).
 */
export type ThemeMode = "light" | "dark";
export type ThemeModePreference = ThemeMode | "system";

export const THEME_PREFERENCE_STORAGE_KEY = "bb.theme";
const DEFAULT_THEME_PREFERENCE: ThemeModePreference = "system";

/** Minimal synchronous key/value store; MMKV in the app, a Map in tests. */
export interface ThemePreferenceStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const PREFERENCES: readonly ThemeModePreference[] = ["system", "light", "dark"];

/** Narrow a stored/untrusted string to a preference; anything else → system. */
export function parseThemePreference(
  value: string | null | undefined,
): ThemeModePreference {
  return (
    PREFERENCES.find((candidate) => candidate === value) ??
    DEFAULT_THEME_PREFERENCE
  );
}

export function readThemePreference(
  storage: ThemePreferenceStorage,
): ThemeModePreference {
  return parseThemePreference(storage.getString(THEME_PREFERENCE_STORAGE_KEY));
}

export function writeThemePreference(
  storage: ThemePreferenceStorage,
  preference: ThemeModePreference,
): void {
  if (preference === DEFAULT_THEME_PREFERENCE) {
    storage.remove(THEME_PREFERENCE_STORAGE_KEY);
    return;
  }
  storage.set(THEME_PREFERENCE_STORAGE_KEY, preference);
}

/**
 * The effective mode: an explicit preference wins; `system` follows the OS
 * appearance and falls back to light when the OS reports none (RN's
 * `useColorScheme` returns `"unspecified"`, `null`, or `undefined` before the
 * first Appearance event and on some Android builds).
 */
export function resolveThemeMode(
  preference: ThemeModePreference,
  systemScheme: string | null | undefined,
): ThemeMode {
  if (preference !== "system") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}
