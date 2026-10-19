import { useAtomValue } from "jotai";
import {
  createReplacementPreferenceAtom,
  usePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlots,
  type PluginDiffRendererSlot,
  type PluginSourceCodeRendererSlot,
} from "@/lib/plugin-slots";

const SOURCE_CODE_RENDERER_STORAGE_KEY = "bb.appearance.sourceCodeRenderer";
const DIFF_RENDERER_STORAGE_KEY = "bb.appearance.diffRenderer";

export const sourceCodeRendererProviderAtom = createReplacementPreferenceAtom(
  SOURCE_CODE_RENDERER_STORAGE_KEY,
);

export const diffRendererProviderAtom = createReplacementPreferenceAtom(
  DIFF_RENDERER_STORAGE_KEY,
);

export function useSourceCodeRendererReplacement(): ResolvedReplacement<PluginSourceCodeRendererSlot> {
  const { sourceCodeRenderers } = usePluginSlots();
  const preference = useAtomValue(sourceCodeRendererProviderAtom);
  return usePreferredReplacement(sourceCodeRenderers, preference);
}

export function useDiffRendererReplacement(): ResolvedReplacement<PluginDiffRendererSlot> {
  const { diffRenderers } = usePluginSlots();
  const preference = useAtomValue(diffRendererProviderAtom);
  return usePreferredReplacement(diffRenderers, preference);
}
