import { useAtomValue } from "jotai";
import {
  createReplacementPreferenceAtom,
  usePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlotKind,
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
  const sourceCodeRenderers = usePluginSlotKind("sourceCodeRenderers");
  const preference = useAtomValue(sourceCodeRendererProviderAtom);
  return usePreferredReplacement(sourceCodeRenderers, preference);
}

export function useDiffRendererReplacement(): ResolvedReplacement<PluginDiffRendererSlot> {
  const diffRenderers = usePluginSlotKind("diffRenderers");
  const preference = useAtomValue(diffRendererProviderAtom);
  return usePreferredReplacement(diffRenderers, preference);
}
