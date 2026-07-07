import { atomWithStorage } from "jotai/utils";
import { useAtom, useAtomValue } from "jotai";
import type { PluginFileOpenerSlot } from "./plugin-slots";
import { createJsonLocalStorage } from "./browser-storage";

/**
 * Default file opener per extension: `"<ext>" → "<pluginId>:<openerId>"`.
 * Extensions absent from the map (or pointing at an opener that is no longer
 * registered) fall back to the built-in preview — a removed plugin can never
 * dead-end file opening. Stored client-side like the other view preferences
 * (see workspace-open-target-preference.ts).
 */
export type FileOpenerPreferenceMap = Record<string, string>;

const FILE_OPENER_PREFERENCE_STORAGE_KEY = "bb.fileOpenerByExtension";

const fileOpenerPreferenceAtom = atomWithStorage<FileOpenerPreferenceMap>(
  FILE_OPENER_PREFERENCE_STORAGE_KEY,
  {},
  createJsonLocalStorage<FileOpenerPreferenceMap>(),
  { getOnInit: true },
);

export function useFileOpenerPreference() {
  return useAtom(fileOpenerPreferenceAtom);
}

export function useFileOpenerPreferenceValue(): FileOpenerPreferenceMap {
  return useAtomValue(fileOpenerPreferenceAtom);
}

/** Lowercased extension without the dot; null when the name has none. */
export function getFileExtension(path: string): string | null {
  const name = path.split("/").at(-1) ?? path;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return null;
  return name.slice(dotIndex + 1).toLowerCase();
}

export function buildFileOpenerRef(opener: {
  pluginId: string;
  id: string;
}): string {
  return `${opener.pluginId}:${opener.id}`;
}

export function findFileOpenersForPath(
  openers: readonly PluginFileOpenerSlot[],
  path: string,
): PluginFileOpenerSlot[] {
  const extension = getFileExtension(path);
  if (extension === null) return [];
  return openers.filter((opener) => opener.extensions.includes(extension));
}

/**
 * The opener the given path should open with, or null for the built-in
 * preview (no preference, an unknown extension, or a preferred opener that
 * is no longer registered).
 */
export function resolvePreferredFileOpener(args: {
  openers: readonly PluginFileOpenerSlot[];
  preference: FileOpenerPreferenceMap;
  path: string;
}): PluginFileOpenerSlot | null {
  const extension = getFileExtension(args.path);
  if (extension === null) return null;
  const preferredRef = args.preference[extension];
  if (preferredRef === undefined) return null;
  return (
    args.openers.find(
      (opener) =>
        buildFileOpenerRef(opener) === preferredRef &&
        opener.extensions.includes(extension),
    ) ?? null
  );
}
