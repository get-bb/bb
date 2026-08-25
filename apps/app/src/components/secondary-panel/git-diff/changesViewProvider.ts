import { useAtomValue } from "jotai";
import {
  createReplacementPreferenceAtom,
  resolvePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlots,
  type ExperimentalChangesViewSlot,
} from "@/lib/plugin-slots";

const CHANGES_VIEW_STORAGE_KEY = "bb.appearance.changesView";

/** Automatic by default, with an independent per-client Appearance pin. */
export const changesViewProviderAtom = createReplacementPreferenceAtom(
  CHANGES_VIEW_STORAGE_KEY,
);

/** The active whole-Changes replacement, or BB's view when none applies. */
export function useChangesViewReplacement(): ResolvedReplacement<ExperimentalChangesViewSlot> {
  const { experimentalChangesViews } = usePluginSlots();
  const preference = useAtomValue(changesViewProviderAtom);
  return resolvePreferredReplacement(experimentalChangesViews, preference);
}
