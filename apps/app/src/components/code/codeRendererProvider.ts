import { useAtomValue } from "jotai";
import {
  createReplacementPreferenceAtom,
  usePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlotKind,
  type PluginDiffRendererSlot,
} from "@/lib/plugin-slots";

const DIFF_RENDERER_STORAGE_KEY = "bb.appearance.diffRenderer";

export const diffRendererProviderAtom = createReplacementPreferenceAtom(
  DIFF_RENDERER_STORAGE_KEY,
);

export function useDiffRendererReplacement(): ResolvedReplacement<PluginDiffRendererSlot> {
  const diffRenderers = usePluginSlotKind("diffRenderers");
  const preference = useAtomValue(diffRendererProviderAtom);
  return usePreferredReplacement(diffRenderers, preference);
}
