import { useAtomValue } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  usePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginComposerSlot } from "@/lib/plugin-slots";
import { useRememberSurfaceProvider } from "@/lib/plugin-surface-providers";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const composerRendererProviderAtom =
  createSyncedPreferenceAtom("composer.provider");

export function useComposerReplacement(): ResolvedReplacement<PluginComposerSlot> {
  const { composers } = usePluginSlots();
  const preference = useAtomValue(composerRendererProviderAtom);
  const resolved = usePreferredReplacement(
    composers,
    preference === BUILT_IN_REPLACEMENT_PROVIDER
      ? AUTOMATIC_REPLACEMENT_PROVIDER
      : preference,
  );
  useRememberSurfaceProvider(
    "composer",
    resolved.kind === "plugin" ? resolved.registration.pluginId : null,
  );
  return resolved;
}
