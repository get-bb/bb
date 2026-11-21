import { useAtom, useAtomValue } from "jotai";
import {
  BUILT_IN_REPLACEMENT_PROVIDER,
  createLegacyLocalPick,
  createPickMapPreferenceAtom,
} from "./plugin-replacement-preference";
import type { FileOpenerPreferenceMap } from "./plugin-slot-resolvers";

function legacyFileOpenerPicks(stored: unknown): Record<string, string> | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return null;
  }
  const picks: Record<string, string> = {};
  for (const [extension, pick] of Object.entries(stored)) {
    if (typeof pick !== "string" || extension.length === 0) continue;
    if (pick === BUILT_IN_REPLACEMENT_PROVIDER) {
      picks[extension] = pick;
      continue;
    }
    const separator = pick.indexOf(":");
    if (separator <= 0 || separator === pick.length - 1) continue;
    picks[extension] =
      `${pick.slice(0, separator)}/${pick.slice(separator + 1)}`;
  }
  return Object.keys(picks).length === 0 ? null : picks;
}

export const fileOpenerPreferenceAtom = createPickMapPreferenceAtom(
  "fileOpener.byExtension",
  {
    legacy: createLegacyLocalPick(
      "bb.fileOpenerByExtension",
      legacyFileOpenerPicks,
    ),
  },
);

export function useFileOpenerPreference() {
  return useAtom(fileOpenerPreferenceAtom);
}

export function useFileOpenerPreferenceValue(): FileOpenerPreferenceMap {
  return useAtomValue(fileOpenerPreferenceAtom);
}
