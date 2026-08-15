import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import type { PluginComposerCustomizationSlot } from "@/lib/plugin-slots";

/** Preserve snapshot order while applying the shared composer scope contract. */
export function composerCustomizationsForScope(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly PluginComposerCustomizationSlot[] {
  return customizations.filter(
    (customization) =>
      customization.scopes === undefined ||
      customization.scopes.includes(scopeKind),
  );
}
