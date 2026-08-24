import type { CSSProperties } from "react";
import { isPresentationTintColor } from "@bb/domain";
import type { TimelineRowPresentation } from "@bb/server-contract";
import { ICON_NAMES, type IconName } from "@bb/shared-ui/icon";

/**
 * The declarative base every client renders from a row's persisted
 * `presentation` (docs/provider-plugin-api.md §5): the bridge's glyph name
 * and per-theme tint. Pure helpers so the row renderer and tests share one
 * reading of the schema.
 */

const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);

/**
 * Whether this host's icon registry can draw a glyph a bridge named. A glyph
 * outside the registry (a newer SDK, a typo) is not an icon name, so callers
 * fall back to the per-kind glyph instead of rendering an empty svg.
 */
export function isIconName(value: string): value is IconName {
  // ICON_NAMES is the exhaustive registry; membership is the narrowing.
  return ICON_NAME_SET.has(value);
}

/** The row's leading glyph when the bridge named one the host knows. */
export function presentationIconName(
  presentation: { icon: TimelineRowPresentation["icon"] } | undefined,
): IconName | undefined {
  const glyph = presentation?.icon.glyph;
  return glyph !== undefined && isIconName(glyph) ? glyph : undefined;
}

/**
 * An inline style that paints the row accent in the bridge's tint, picking
 * the light or dark value through `light-dark()` so it follows the app's
 * `color-scheme` (set by the `.dark` theme root) without a re-render on
 * theme change. `undefined` when the row has no tint or it fails the colour
 * grammar, so the element keeps the neutral row colour.
 */
export function presentationTintStyle(
  presentation:
    | { tint?: TimelineRowPresentation["tint"] | null | undefined }
    | undefined,
): CSSProperties | undefined {
  const tint = presentation?.tint;
  if (
    tint === undefined ||
    tint === null ||
    !isPresentationTintColor(tint.light) ||
    !isPresentationTintColor(tint.dark)
  ) {
    return undefined;
  }
  return { color: `light-dark(${tint.light.trim()}, ${tint.dark.trim()})` };
}
