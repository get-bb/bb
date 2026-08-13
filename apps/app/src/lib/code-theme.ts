import { useEffect, useMemo, useSyncExternalStore } from "react";
import { registerCustomTheme } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import {
  defaultResolvedCodeTheme,
  stampRegisteredThemeName,
  type ResolvedCodeTheme,
} from "@bb/domain";

const CODE_THEME_DARK_DATASET = "bbCodeThemeDark";
const CODE_THEME_LIGHT_DATASET = "bbCodeThemeLight";

let currentResolvedCodeTheme: ResolvedCodeTheme = defaultResolvedCodeTheme;
const subscribers = new Set<() => void>();
const registeredFileNames = new Set<string>();

function publish(): void {
  for (const subscriber of subscribers) subscriber();
}

function writeDocumentDataset(resolved: ResolvedCodeTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset[CODE_THEME_DARK_DATASET] = resolved.dark;
  root.dataset[CODE_THEME_LIGHT_DATASET] = resolved.light;
}

function registerFiles(resolved: ResolvedCodeTheme): void {
  for (const [name, theme] of Object.entries(resolved.files)) {
    if (registeredFileNames.has(name)) continue;
    registeredFileNames.add(name);
    const stamped = stampRegisteredThemeName(name, theme);
    registerCustomTheme(name, () => Promise.resolve(stamped));
  }
}

export function getResolvedCodeTheme(): ResolvedCodeTheme {
  return currentResolvedCodeTheme;
}

export function subscribeResolvedCodeTheme(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Register custom Pierre JSON files and publish the resolved dark/light names
 * for every FileDiff / File surface and first-party plugin renderers.
 */
export function applyResolvedCodeTheme(resolved: ResolvedCodeTheme): void {
  registerFiles(resolved);
  writeDocumentDataset(resolved);
  if (
    currentResolvedCodeTheme.dark === resolved.dark &&
    currentResolvedCodeTheme.light === resolved.light &&
    currentResolvedCodeTheme.files === resolved.files
  ) {
    return;
  }
  currentResolvedCodeTheme = resolved;
  publish();
}

export function useResolvedCodeTheme(): ResolvedCodeTheme {
  return useSyncExternalStore(
    subscribeResolvedCodeTheme,
    getResolvedCodeTheme,
    getResolvedCodeTheme,
  );
}

export function useResolvedCodeThemePair(): {
  dark: string;
  light: string;
} {
  const resolved = useResolvedCodeTheme();
  return useMemo(
    () => ({ dark: resolved.dark, light: resolved.light }),
    [resolved.dark, resolved.light],
  );
}

/**
 * File / FileDiff ignore `options.theme` while a worker pool is active and
 * highlight with the pool's render options instead. Push the resolved pair
 * into that pool after custom JSON is registered.
 */
export function useSyncPierreWorkerPoolTheme(): void {
  const pool = useWorkerPool();
  const theme = useResolvedCodeThemePair();
  useEffect(() => {
    if (pool == null) return;
    void pool.setRenderOptions({ theme }).catch((error: unknown) => {
      console.error("Failed to apply the code theme to the Pierre worker pool", error);
    });
  }, [pool, theme]);
}

/** Read the host-published names. Plugins that render FileDiff should use this. */
export function readHostCodeThemePair(): { dark: string; light: string } {
  if (typeof document === "undefined") {
    return {
      dark: defaultResolvedCodeTheme.dark,
      light: defaultResolvedCodeTheme.light,
    };
  }
  const root = document.documentElement.dataset;
  return {
    dark: root[CODE_THEME_DARK_DATASET] ?? defaultResolvedCodeTheme.dark,
    light: root[CODE_THEME_LIGHT_DATASET] ?? defaultResolvedCodeTheme.light,
  };
}
