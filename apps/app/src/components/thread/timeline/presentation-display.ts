import type { CSSProperties } from "react";
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
 * The row's leading glyph when the bridge named one the host knows. A glyph
 * outside the host registry (a newer SDK, a typo) yields `undefined` so the
 * per-kind fallback glyph still renders instead of an empty svg.
 */
export function presentationIconName(
  presentation: TimelineRowPresentation | undefined,
): IconName | undefined {
  const glyph = presentation?.icon.glyph;
  // ICON_NAMES is the exhaustive registry; membership is the narrowing.
  return glyph !== undefined && ICON_NAME_SET.has(glyph)
    ? (glyph as IconName)
    : undefined;
}

// A conservative CSS <color> grammar: hex, the functional notations, and
// named colours. Anything else (a `url()`, a `var()`, an `expression()`)
// is plugin data the row must not inject into a style attribute.
const CSS_COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([-+.%\w\s,/]*\)|[a-z]{3,20})$/iu;

export function isPresentationTintColor(value: string): boolean {
  return CSS_COLOR_PATTERN.test(value.trim());
}

/**
 * An inline style that paints the row accent in the bridge's tint, picking
 * the light or dark value through `light-dark()` so it follows the app's
 * `color-scheme` (set by the `.dark` theme root) without a re-render on
 * theme change. `undefined` when the row has no tint or it fails the colour
 * grammar, so the element keeps the neutral row colour.
 */
export function presentationTintStyle(
  presentation: TimelineRowPresentation | undefined,
): CSSProperties | undefined {
  const tint = presentation?.tint;
  if (
    tint === undefined ||
    !isPresentationTintColor(tint.light) ||
    !isPresentationTintColor(tint.dark)
  ) {
    return undefined;
  }
  return { color: `light-dark(${tint.light.trim()}, ${tint.dark.trim()})` };
}
