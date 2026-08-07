import { useEffect, useSyncExternalStore } from "react";
import { useSystemConfig } from "@/hooks/queries/system-queries";

export const UI_FONT_FAMILY_STORAGE_KEY = "bb.appearance.ui-font-family";
export const BUFFER_FONT_FAMILY_STORAGE_KEY =
  "bb.appearance.buffer-font-family";

export const UI_FONT_CSS_VARIABLES = [
  "--font-sans",
  "--diffs-header-font-family",
] as const;
export const BUFFER_FONT_CSS_VARIABLES = [
  "--font-mono",
  "--diffs-font-family",
] as const;

export interface FontPreferences {
  bufferFontFamily: string;
  uiFontFamily: string;
}

let fontPreferenceEpoch = 0;
const fontPreferenceSubscribers = new Set<() => void>();

export function normalizeFontFamily(value: string): string {
  return value
    .replace(/[;{}\r\n]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 256);
}

export function resolveFontFamilyPreference(
  preference: string,
  themeVariable: string,
  fallback: string,
): string {
  const configured = normalizeFontFamily(preference);
  if (configured.length > 0) {
    return configured;
  }
  if (typeof document === "undefined") {
    return fallback;
  }
  const themed = normalizeFontFamily(
    getComputedStyle(document.documentElement).getPropertyValue(themeVariable),
  );
  return themed || fallback;
}

function applyFontFamily(
  properties: readonly string[],
  fontFamily: string,
): boolean {
  const value = normalizeFontFamily(fontFamily);
  let changed = false;
  for (const property of properties) {
    if (document.documentElement.style.getPropertyValue(property) === value) {
      continue;
    }
    changed = true;
    if (value.length === 0) {
      document.documentElement.style.removeProperty(property);
    } else {
      document.documentElement.style.setProperty(property, value);
    }
  }
  return changed;
}

function cacheFontFamily(storageKey: string, fontFamily: string): void {
  try {
    if (fontFamily.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, fontFamily);
    }
  } catch {
    // The cache only prevents a font flash. The server remains authoritative.
  }
}

export function applyFontPreferences(
  { bufferFontFamily, uiFontFamily }: FontPreferences,
  options: { cache?: boolean } = {},
): void {
  const normalizedBufferFontFamily = normalizeFontFamily(bufferFontFamily);
  const normalizedUiFontFamily = normalizeFontFamily(uiFontFamily);
  const uiChanged = applyFontFamily(
    UI_FONT_CSS_VARIABLES,
    normalizedUiFontFamily,
  );
  const bufferChanged = applyFontFamily(
    BUFFER_FONT_CSS_VARIABLES,
    normalizedBufferFontFamily,
  );

  if (uiChanged || bufferChanged) {
    fontPreferenceEpoch += 1;
    fontPreferenceSubscribers.forEach((subscriber) => subscriber());
  }

  if (options.cache) {
    cacheFontFamily(UI_FONT_FAMILY_STORAGE_KEY, normalizedUiFontFamily);
    cacheFontFamily(BUFFER_FONT_FAMILY_STORAGE_KEY, normalizedBufferFontFamily);
  }
}

function readCachedFontFamily(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

export function readCachedFontPreferences(): FontPreferences {
  return {
    bufferFontFamily: readCachedFontFamily(BUFFER_FONT_FAMILY_STORAGE_KEY),
    uiFontFamily: readCachedFontFamily(UI_FONT_FAMILY_STORAGE_KEY),
  };
}

export function initializeFontPreferences(): void {
  applyFontPreferences(readCachedFontPreferences());
}

export function useAppFontPreferences(): void {
  const { data } = useSystemConfig();
  const settings = data?.generalSettings;

  useEffect(() => {
    if (!settings) {
      return;
    }
    applyFontPreferences(settings, { cache: true });
  }, [settings]);
}

export function useFontPreferenceEpoch(): number {
  return useSyncExternalStore(
    (subscriber) => {
      fontPreferenceSubscribers.add(subscriber);
      return () => {
        fontPreferenceSubscribers.delete(subscriber);
      };
    },
    () => fontPreferenceEpoch,
    () => fontPreferenceEpoch,
  );
}

export function useBufferFontFamily(): string {
  const { data } = useSystemConfig();
  return (
    data?.generalSettings.bufferFontFamily ??
    readCachedFontPreferences().bufferFontFamily
  );
}

export function useUiFontFamily(): string {
  const { data } = useSystemConfig();
  return (
    data?.generalSettings.uiFontFamily ??
    readCachedFontPreferences().uiFontFamily
  );
}
