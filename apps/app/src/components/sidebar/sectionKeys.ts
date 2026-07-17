// Pure helpers for sidebar section row identity. Section names are display text;
// membership lives in `thread.sectionId`.

export function buildSectionKey(
  containerId: string,
  sectionId: string,
): string {
  return `${containerId}::${sectionId}`;
}

export function sectionKeyForThreadSection(
  containerId: string,
  sectionId: string | null | undefined,
): string | null {
  if (!sectionId) {
    return null;
  }
  return buildSectionKey(containerId, sectionId);
}
