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
