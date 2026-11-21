import { useAtomValue } from "jotai";
import {
  createLegacyLocalPick,
  createPickPreferenceAtom,
  REPLACEMENT_RULE,
  useExclusiveResolution,
  type ExclusiveResolution,
} from "@/lib/plugin-replacement-preference";
import {
  usePluginSlotKind,
  type PluginDiffRendererSlot,
  type PluginSourceCodeRendererSlot,
} from "@/lib/plugin-slots";

function legacyPick(stored: unknown): string | null {
  return typeof stored === "string" && stored.length > 0 ? stored : null;
}

export const sourceCodeRendererProviderAtom = createPickPreferenceAtom(
  "sourceCode.provider",
  {
    legacy: createLegacyLocalPick(
      "bb.appearance.sourceCodeRenderer",
      legacyPick,
    ),
  },
);

export const diffRendererProviderAtom = createPickPreferenceAtom(
  "diff.provider",
  { legacy: createLegacyLocalPick("bb.appearance.diffRenderer", legacyPick) },
);

export function useSourceCodeRendererReplacement(): ExclusiveResolution<PluginSourceCodeRendererSlot> {
  const sourceCodeRenderers = usePluginSlotKind("sourceCodeRenderers");
  const preference = useAtomValue(sourceCodeRendererProviderAtom);
  return useExclusiveResolution(
    sourceCodeRenderers,
    preference,
    REPLACEMENT_RULE,
  );
}

export function useDiffRendererReplacement(): ExclusiveResolution<PluginDiffRendererSlot> {
  const diffRenderers = usePluginSlotKind("diffRenderers");
  const preference = useAtomValue(diffRendererProviderAtom);
  return useExclusiveResolution(diffRenderers, preference, REPLACEMENT_RULE);
}
