import { atomWithStorage } from "jotai/utils";
import { useAtom, useAtomValue } from "jotai";
import type { PluginFileOpenerSlot } from "./plugin-slots";
import { createJsonLocalStorage } from "./browser-storage";
import {
  buildFileOpenerRef,
  getFileExtension,
  resolveFileOpenerReplacement,
  type FileOpenerPreferenceMap,
} from "./plugin-slot-resolvers";

export { buildFileOpenerRef, getFileExtension, type FileOpenerPreferenceMap };

/**
 * Default file opener per extension: `"<ext>" → "<pluginId>:<openerId>"`.
 * Extensions absent from the map (or pointing at an opener that is no longer
 * registered) fall back to the built-in preview — a removed plugin can never
 * dead-end file opening. Stored client-side like the other view preferences
 * (see workspace-open-target-preference.ts).
 */
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
  const resolved = resolveFileOpenerReplacement({
    registrations: args.openers,
    preference: args.preference,
    path: args.path,
  });
  return resolved.kind === "plugin" ? resolved.registration : null;
}
