import { FAVICON_COLORS, type FaviconColor } from "@bb/domain";
import {
  SERVER_TILE_ICON_NAMES,
  type ServerTileIconName,
} from "@/lib/server-tile-icons";

const ICON_NAME_SET = new Set<string>(SERVER_TILE_ICON_NAMES);
const FAVICON_COLOR_SET = new Set<string>(FAVICON_COLORS);

/**
 * Resolve shell-opaque tile style strings against the renderer registries.
 * Unknown icon/color values fall back to defaults (letter glyph / token color)
 * so version skew either direction stays safe.
 */
export function resolveServerTileIcon(
  icon: string | null,
): ServerTileIconName | null {
  if (icon === null || !ICON_NAME_SET.has(icon)) {
    return null;
  }
  return icon as ServerTileIconName;
}

export function resolveServerTileColor(
  color: string | null,
): FaviconColor | null {
  if (color === null || !FAVICON_COLOR_SET.has(color)) {
    return null;
  }
  return color as FaviconColor;
}
