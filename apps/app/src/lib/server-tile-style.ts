import { FAVICON_COLORS, type FaviconColor } from "@bb/domain";
import { ICON_NAMES, type IconName } from "@bb/shared-ui/icon";

const ICON_NAME_SET = new Set<string>(ICON_NAMES);
const FAVICON_COLOR_SET = new Set<string>(FAVICON_COLORS);

/**
 * Resolve shell-opaque tile style strings against the renderer registries.
 * Unknown icon/color values fall back to defaults (letter glyph / token color)
 * so version skew either direction stays safe.
 */
export function resolveServerTileIcon(icon: string | null): IconName | null {
  if (icon === null || !ICON_NAME_SET.has(icon)) {
    return null;
  }
  return icon as IconName;
}

export function resolveServerTileColor(
  color: string | null,
): FaviconColor | null {
  if (color === null || !FAVICON_COLOR_SET.has(color)) {
    return null;
  }
  return color as FaviconColor;
}
