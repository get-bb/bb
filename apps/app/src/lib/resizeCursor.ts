import { disableGlobalCursorStyles } from "react-resizable-panels";

/**
 * react-resizable-panels injects a global `*{cursor: ew-resize !important}` rule
 * whenever one of its handles is hovered or dragged. That generic edge cursor
 * fights the `cursor-col-resize`/`cursor-row-resize` we set on the handles and,
 * because the library's hover cursor and our handles' hover cursor came from two
 * different regions, produced a dead band where the cursor promised a resize the
 * drag never delivered.
 *
 * We take ownership of the cursor instead so the library's panel splitters match
 * the hand-rolled sidebar splitter: a divider between two panes is a column/row
 * splitter (`col-resize`/`row-resize`), not a single element's edge
 * (`ew-resize`/`ns-resize`). Call once at startup, before any PanelGroup mounts.
 */
export function takeOverPanelResizeCursor(): void {
  disableGlobalCursorStyles();
}

type ResizeOrientation = "horizontal" | "vertical";

const RESIZE_CURSOR_BY_ORIENTATION: Record<ResizeOrientation, string> = {
  horizontal: "col-resize",
  vertical: "row-resize",
};

/**
 * Pin a global resize cursor for the duration of a drag. The pointer spends the
 * drag over panel content rather than the 1px handle, so the handle's own hover
 * cursor no longer applies — the body cursor is what keeps the splitter cursor
 * visible while dragging.
 *
 * `cursor` is inherited, so writing it on body restyles every element in the
 * document at drag start and end. Drags that mount an `IframeDragGuardOverlay`
 * should pass the cursor to the overlay instead and not call this.
 */
export function applyResizeCursor(orientation: ResizeOrientation): void {
  document.body.style.cursor = RESIZE_CURSOR_BY_ORIENTATION[orientation];
}

export function clearResizeCursor(): void {
  document.body.style.cursor = "";
}
