import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  readThemePreference,
  resolveThemeMode,
  THEME_PREFERENCE_STORAGE_KEY,
  writeThemePreference,
  type ThemePreferenceStorage,
} from "./theme-preference";

function memoryStorage(
  initial: Record<string, string> = {},
): ThemePreferenceStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getString: (key) => data.get(key),
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

describe("theme preference", () => {
  it("parses only the three known values and defaults to system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("Dark")).toBe("system");
    expect(parseThemePreference('"dark"')).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("resolves an explicit preference regardless of the OS scheme", () => {
    expect(resolveThemeMode("dark", "light")).toBe("dark");
    expect(resolveThemeMode("light", "dark")).toBe("light");
  });

  it("follows the OS for system and treats unknown schemes as light", () => {
    expect(resolveThemeMode("system", "dark")).toBe("dark");
    expect(resolveThemeMode("system", "light")).toBe("light");
    expect(resolveThemeMode("system", "unspecified")).toBe("light");
    expect(resolveThemeMode("system", null)).toBe("light");
    expect(resolveThemeMode("system", undefined)).toBe("light");
  });

  it("round-trips through storage under the web app's key", () => {
    const storage = memoryStorage();
    writeThemePreference(storage, "dark");
    expect(storage.data.get(THEME_PREFERENCE_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference(storage)).toBe("dark");
  });

  it("clears the key for the default so a stale value cannot linger", () => {
    const storage = memoryStorage({ [THEME_PREFERENCE_STORAGE_KEY]: "light" });
    writeThemePreference(storage, "system");
    expect(storage.data.has(THEME_PREFERENCE_STORAGE_KEY)).toBe(false);
    expect(readThemePreference(storage)).toBe("system");
  });

  it("recovers from corrupt stored values", () => {
    const storage = memoryStorage({ [THEME_PREFERENCE_STORAGE_KEY]: "purple" });
    expect(readThemePreference(storage)).toBe("system");
  });
});
