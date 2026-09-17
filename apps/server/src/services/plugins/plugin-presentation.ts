import type { ThreadEventItemPresentation } from "@bb/domain";
import { isNamespacedGlyph, isPluginOwnedIconPath } from "@bb/domain";
import type { PluginAgentToolPresentation } from "@get-bb/plugin-sdk";

export const GENERIC_PLUGIN_GLYPH = "Toolbox";

/**
 * One complete row presentation from what a plugin declared, filled with the
 * plugin's branding glyph and the given labels where it left fields out. Used
 * for native tool rows and for the row a plugin form leaves in the timeline,
 * so both read the same way.
 */
export function fillPluginPresentation(args: {
  declared: PluginAgentToolPresentation | null;
  brandingIcon: string | undefined;
  label: { pending: string; completed: string };
}): ThreadEventItemPresentation {
  const { declared, brandingIcon } = args;
  const glyph =
    declared?.icon?.glyph ??
    (brandingIcon !== undefined &&
    !isPluginOwnedIconPath(brandingIcon) &&
    !isNamespacedGlyph(brandingIcon)
      ? brandingIcon
      : GENERIC_PLUGIN_GLYPH);
  return {
    label: declared?.label ?? args.label,
    icon: { glyph },
    ...(declared?.suppress === undefined
      ? {}
      : { suppress: declared.suppress }),
    ...(declared?.tint === undefined ? {} : { tint: declared.tint }),
  };
}
