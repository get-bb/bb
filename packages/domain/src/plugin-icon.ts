/**
 * The one icon grammar plugins declare in: either a named host glyph (`"Zap"`)
 * or an explicit plugin-relative compact SVG path (`"./assets/icon.svg"`).
 * Shared by `bb.branding.icon` and the provider declaration's `icon`, so an
 * author learns it once.
 */
export function isPluginOwnedIconPath(icon: string): boolean {
  return icon.startsWith("./");
}
