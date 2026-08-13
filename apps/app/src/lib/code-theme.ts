import { useMemo, useSyncExternalStore } from "react";
import {
  defaultResolvedCodeTheme,
  type JsonObject,
  type ResolvedCodeTheme,
} from "@bb/domain";

const CODE_THEME_DARK_DATASET = "bbCodeThemeDark";
const CODE_THEME_LIGHT_DATASET = "bbCodeThemeLight";

let currentResolvedCodeTheme: ResolvedCodeTheme = defaultResolvedCodeTheme;
const subscribers = new Set<() => void>();

function publish(): void {
  for (const subscriber of subscribers) subscriber();
}

function writeDocumentDataset(resolved: ResolvedCodeTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (
    root.dataset[CODE_THEME_DARK_DATASET] === resolved.dark &&
    root.dataset[CODE_THEME_LIGHT_DATASET] === resolved.light
  ) {
    return;
  }
  root.dataset[CODE_THEME_DARK_DATASET] = resolved.dark;
  root.dataset[CODE_THEME_LIGHT_DATASET] = resolved.light;
}

function fileFingerprint(file: JsonObject): string {
  const json = JSON.stringify(file);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function versionedThemeName(name: string, file: JsonObject | undefined): string {
  if (file === undefined) return name;
  return `${name}:${fileFingerprint(file)}`;
}

function publishableCodeTheme(resolved: ResolvedCodeTheme): ResolvedCodeTheme {
  const files: Record<string, JsonObject> = {};
  for (const [name, file] of Object.entries(resolved.files)) {
    files[versionedThemeName(name, file)] = file;
  }
  return {
    dark: versionedThemeName(resolved.dark, resolved.files[resolved.dark]),
    light: versionedThemeName(resolved.light, resolved.files[resolved.light]),
    files,
  };
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
 * Publish the resolved dark/light names for every FileDiff / File surface
 * and first-party plugin renderers. Pierre file registration lives next to
 * the worker-pool sync so `@pierre/diffs` stays off the app boot path.
 */
export function applyResolvedCodeTheme(resolved: ResolvedCodeTheme): void {
  const published = publishableCodeTheme(resolved);
  writeDocumentDataset(published);
  if (
    currentResolvedCodeTheme.dark === published.dark &&
    currentResolvedCodeTheme.light === published.light
  ) {
    return;
  }
  currentResolvedCodeTheme = published;
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
