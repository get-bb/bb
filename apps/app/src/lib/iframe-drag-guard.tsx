export interface IframeDragGuardOverlayProps {
  active: boolean;
}

/**
 * Transparent, viewport-filling overlay shown only while a panel or the sidebar
 * is being drag-resized.
 *
 * Embedded iframes are separate documents: when the pointer crosses one
 * mid-drag, pointer events route into the iframe and the parent's drag tracking
 * freezes. The tempting fix — toggling the iframe's own `pointer-events` to
 * `none` during the drag — detaches the iframe's compositor scroll node in
 * Chromium, leaving wheel-scrolling dead after the drag ends (programmatic
 * scrolling still works, which is the tell). Instead we lay this overlay over
 * the viewport for the duration of the drag so the iframe never becomes the
 * pointer target, while its `pointer-events` stay untouched. `position: fixed`
 * means it covers everything regardless of where it mounts and is not clipped
 * by an ancestor's `overflow`.
 */
export function IframeDragGuardOverlay({ active }: IframeDragGuardOverlayProps) {
  if (!active) {
    return null;
  }
  return (
    <div
      aria-hidden
      data-testid="iframe-drag-guard-overlay"
      className="fixed inset-0 z-50"
    />
  );
}
