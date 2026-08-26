/**
 * Client-local shell settings, in the same `bb.preferences` MMKV store the
 * haptics toggle uses. The switch is a device choice, not server policy: two
 * phones on one server may disagree while the shell is still an experiment.
 */

export const WEBVIEW_SHELL_ENABLED_STORAGE_KEY = "bb.webviewShell.enabled";
const WEBVIEW_SHELL_ENABLED_DEFAULT = false;

/** Per-profile last page path, so a cold start reopens where the user was. */
export function lastShellPathStorageKey(profileId: string): string {
  return `bb.webviewShell.lastPath.${profileId}`;
}

export function parseWebViewShellEnabled(stored: string | undefined): boolean {
  if (stored === undefined) return WEBVIEW_SHELL_ENABLED_DEFAULT;
  return stored === "true";
}

export interface ShellPreferenceStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface ShellPreferenceStore {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  subscribe(listener: () => void): () => void;
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
  const listeners = new Set<() => void>();
  // Read through on every call rather than caching. The e2e reset and the
  // "forget this device" path wipe the whole `bb.preferences` store behind
  // this handle, and a cached `true` there would strand the app on a shell
  // it has no profile for. `isEnabled` returns a primitive, so
  // `useSyncExternalStore` is happy with a fresh read.
  const read = () =>
    parseWebViewShellEnabled(
      storage.getString(WEBVIEW_SHELL_ENABLED_STORAGE_KEY),
    );
  return {
    isEnabled: read,
    setEnabled: (next) => {
      if (next === read()) return;
      storage.set(WEBVIEW_SHELL_ENABLED_STORAGE_KEY, next ? "true" : "false");
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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
