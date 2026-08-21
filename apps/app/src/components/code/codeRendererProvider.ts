import { useAtomValue } from "jotai";
import {
  createReplacementPreferenceAtom,
  resolvePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlots,
  type PluginDiffRendererSlot,
  type PluginSourceCodeRendererSlot,
} from "@/lib/plugin-slots";

const SOURCE_CODE_RENDERER_STORAGE_KEY = "bb.appearance.sourceCodeRenderer";
const DIFF_RENDERER_STORAGE_KEY = "bb.appearance.diffRenderer";

/**
 * Automatic by default, with an explicit per-client override in Appearance —
 * the same pin the sidebar thread list offers. A renderer replaces a surface
 * the user cannot otherwise get back without disabling the whole plugin, so
 * the pin is what keeps "installing activates it" reversible.
 */
export const sourceCodeRendererProviderAtom = createReplacementPreferenceAtom(
  SOURCE_CODE_RENDERER_STORAGE_KEY,
);

export const diffRendererProviderAtom = createReplacementPreferenceAtom(
  DIFF_RENDERER_STORAGE_KEY,
);

/** The active source renderer, or the owner when none applies. */
export function useSourceCodeRendererReplacement(): ResolvedReplacement<PluginSourceCodeRendererSlot> {
  const { sourceCodeRenderers } = usePluginSlots();
  const preference = useAtomValue(sourceCodeRendererProviderAtom);
  return resolvePreferredReplacement(sourceCodeRenderers, preference);
}

/** The active diff renderer, or the owner when none applies. */
export function useDiffRendererReplacement(): ResolvedReplacement<PluginDiffRendererSlot> {
  const { diffRenderers } = usePluginSlots();
  const preference = useAtomValue(diffRendererProviderAtom);
  return resolvePreferredReplacement(diffRenderers, preference);
}
