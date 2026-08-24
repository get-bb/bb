import { cn } from "@bb/shared-ui/lib/utils";

interface IframeDragGuardOverlayProps {
  active: boolean;
  /**
   * Cursor to show for the whole drag. The overlay is the pointer target for
   * the duration of the drag, so the cursor lives here rather than on `body`:
   * `cursor` is inherited, and setting it on `body` restyles every element in
   * the document (hundreds of milliseconds in a long thread).
   */
  cursor: "col-resize" | "row-resize";
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
 *
 * Mount it AFTER its large siblings, never before them. Mounting and
 * unmounting an element invalidates the style of every following sibling's
 * subtree; placed before the app root, the toggle at drag start and drag end
 * restyled the whole app (~400 ms in a long thread). Placed last it costs
 * nothing, and `fixed` plus the same z-index keeps it on top either way.
 */
export function IframeDragGuardOverlay({
  active,
  cursor,
}: IframeDragGuardOverlayProps) {
  if (!active) {
    return null;
  }
  return (
    <div
      aria-hidden
      data-testid="iframe-drag-guard-overlay"
      className={cn(
        "fixed inset-0 z-50",
        cursor === "col-resize" ? "cursor-col-resize" : "cursor-row-resize",
      )}
    />
  );
}
