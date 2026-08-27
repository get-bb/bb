/**
 * Client-local shell state, in the same `bb.preferences` MMKV store the
 * haptics toggle uses.
 *
 * There is no longer an on/off switch. The page is the only interface this app
 * has, so the shell is unconditional; all that survives is where each profile
 * was last looking.
 */

/** Per-profile last page path, so a cold start reopens where the user was. */
export function lastShellPathStorageKey(profileId: string): string {
  return `bb.webviewShell.lastPath.${profileId}`;
}

export interface ShellPreferenceStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface ShellPreferenceStore {
  getLastPath(profileId: string): string | null;
  setLastPath(profileId: string, path: string): void;
}

/** Paths longer than this are a bug or an attack; a URL bar has no such page. */
const MAX_REMEMBERED_PATH_LENGTH = 512;

export function isRememberablePath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    path.length <= MAX_REMEMBERED_PATH_LENGTH
  );
}

export function createShellPreferenceStore(
  storage: ShellPreferenceStorage,
): ShellPreferenceStore {
  return {
    getLastPath: (profileId) => {
      const stored = storage.getString(lastShellPathStorageKey(profileId));
      if (stored === undefined || !isRememberablePath(stored)) return null;
      return stored;
    },
    setLastPath: (profileId, path) => {
      if (!isRememberablePath(path)) return;
      storage.set(lastShellPathStorageKey(profileId), path);
    },
  };
}
