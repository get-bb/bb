// Pure helpers for sidebar folder row identity. Folder names are display text;
// membership lives in `thread.folderId`.

export function buildFolderKey(containerId: string, folderId: string): string {
  return `${containerId}::${folderId}`;
}

export function folderKeyForThreadFolder(
  containerId: string,
  folderId: string | null | undefined,
): string | null {
  if (!folderId) {
    return null;
  }
  return buildFolderKey(containerId, folderId);
}
