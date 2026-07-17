export const SIDEBAR_COLLAPSED_STORAGE_KEY = "bb-tasks:sidebar-collapsed";

/**
 * The Tasks sidebar is a client-local layout preference. Keeping it in the
 * browser profile avoids changing another client connected to the same bb
 * server. Missing, invalid, or unavailable storage preserves the existing
 * first-use default: expanded.
 */
export function loadSidebarCollapsed(): boolean {
  try {
    return (
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(collapsed),
    );
  } catch {
    // Persistence is best-effort (for example, storage-disabled browsers).
  }
}
