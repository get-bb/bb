export const BROWSER_VIEW_BOUNDS_SYNC_EVENT = "bb:browser-view-bounds-sync";

export function dispatchBrowserViewBoundsSync(): void {
  window.dispatchEvent(new Event(BROWSER_VIEW_BOUNDS_SYNC_EVENT));
}
