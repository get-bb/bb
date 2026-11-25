import { useAtomValue } from "jotai";
import {
  createPickPreferenceAtom,
  createRememberedAutomatic,
  PLUGIN_ONLY_RULE,
  useExclusiveResolution,
  type ExclusiveResolution,
} from "@/lib/plugin-replacement-preference";
import { usePluginSlotKind, type PluginComposerSlot } from "@/lib/plugin-slots";
import { useRememberSurfaceProvider } from "@/lib/plugin-surface-providers";

export const composerRendererProviderAtom =
  createPickPreferenceAtom("composer.provider");

const rememberedComposer = createRememberedAutomatic("bb.composer-resolved");

export function useComposerReplacement(): ExclusiveResolution<PluginComposerSlot> {
  const composers = usePluginSlotKind("composers");
  const preference = useAtomValue(composerRendererProviderAtom);
  const resolved = useExclusiveResolution(
    composers,
    preference,
    PLUGIN_ONLY_RULE,
    rememberedComposer,
  );
  useRememberSurfaceProvider(
    "composer",
    resolved.kind === "plugin" ? resolved.registration.pluginId : null,
  );
  return resolved;
}
