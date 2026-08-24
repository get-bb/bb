/**
 * The path form of the icon grammar plugins declare in: a named host glyph
 * (`"Zap"`) or an explicit plugin-relative compact SVG path
 * (`"./assets/icon.svg"`). `bb.branding.icon` takes exactly those two forms;
 * the provider declaration's `icon` takes them plus one of the plugin's own
 * declared icons as a namespaced glyph (see below), so an author learns the
 * path rule once.
 */
export function isPluginOwnedIconPath(icon: string): boolean {
  return icon.startsWith("./");
}

// ---------------------------------------------------------------------------
// Plugin-declared icons (`bb.branding.experimental_icons`).
//
// A plugin ships SVG files and declares a name → file map in its manifest.
// Timeline row presentation (`presentation.icon.glyph`) and provider branding
// (`bb.providers.register({ icon })`) reference those files by a namespaced
// glyph `"<pluginId>/<name>"`. The server validates the map at plugin load,
// serves the bytes from the installed plugin directory, and rejects at ingest
// a namespaced glyph that does not name the emitting plugin's own declared
// icon. Clients resolve the glyph against the plugin inventory they already
// hold; an icon whose plugin is gone or whose name is unknown is simply not
// found and the per-kind fallback glyph renders.
// ---------------------------------------------------------------------------

/** Declared icon names: lowercase letters, digits and `-`, starting with a letter or digit. */
export const PLUGIN_ICON_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

/** Longest declared icon name. */
export const PLUGIN_ICON_NAME_MAX_LENGTH = 48;

/** Largest SVG file a declared icon may be. */
export const PLUGIN_ICON_MAX_BYTES = 32 * 1024;

/** Most icons one plugin may declare. */
export const PLUGIN_ICONS_MAX_COUNT = 64;

/**
 * A namespaced glyph, `"<pluginId>/<name>"`: the same split as an extension
 * kind (`EXTENSION_KIND_PATTERN`), with the name held to the declared-icon
 * grammar. Host glyph names are PascalCase without a `/`, so the two
 * vocabularies cannot collide.
 */
export const NAMESPACED_GLYPH_PATTERN = /^[a-z0-9-]+\/[a-z0-9][a-z0-9-]*$/u;

export function isNamespacedGlyph(glyph: string): boolean {
  return NAMESPACED_GLYPH_PATTERN.test(glyph);
}

/**
 * Split a namespaced glyph into the plugin that declares the icon and the
 * declared name. Null for anything else (a host glyph, a path, a blank), so a
 * caller can resolve without first testing the grammar itself.
 */
export function parseNamespacedGlyph(
  glyph: string,
): { pluginId: string; name: string } | null {
  if (!isNamespacedGlyph(glyph)) {
    return null;
  }
  const separator = glyph.indexOf("/");
  return {
    pluginId: glyph.slice(0, separator),
    name: glyph.slice(separator + 1),
  };
}
