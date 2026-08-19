/**
 * Tiny external store for "is the compact sidebar drawer showing right now".
 *
 * `SidebarProvider` writes it; non-React consumers that must not subscribe to
 * the whole `SidebarContext` (which would re-render every memoized sidebar row
 * on each drawer toggle) read and subscribe here instead. Today the reader is
 * the sidebar dnd touch sensor, which keeps its scroll-blocking window
 * `touchmove` listener installed only while the drawer is open.
 */
let compactSidebarDrawerShowing = false;
const listeners = new Set<() => void>();

export function isCompactSidebarDrawerShowing(): boolean {
  return compactSidebarDrawerShowing;
}

export function setCompactSidebarDrawerShowing(showing: boolean): void {
  if (compactSidebarDrawerShowing === showing) {
    return;
  }
  compactSidebarDrawerShowing = showing;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCompactSidebarDrawerShowing(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
