export function getPluginHomepageSectionAnchor(
  pluginId: string,
  sectionId: string,
): string {
  // Colons are excluded from both plugin and slot IDs, so this remains unique
  // even when either side contains hyphens.
  return `plugin-homepage:${pluginId}:${sectionId}`;
}
