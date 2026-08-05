import { createContext } from "react";

/**
 * Provided by a window-level secondary-panel host (the split workspace) around
 * the whole workspace it lays out. Carries the window's panel visibility for
 * two consumers:
 * - A pane's ThreadSecondaryPanel mounting into the host's PanelGroup sizes
 *   itself to the window state. The pane's own persisted open state can lag
 *   one commit behind (the host aligns it right after a focus or thread
 *   switch), and a defaultSize computed from that stale value would make the
 *   group collapse the freshly mounted panel and misreport a user close.
 * - The right-edge pane headers reserve the window toggle's corner footprint
 *   only while the panel is closed; open, the toggle overlays the panel's own
 *   chrome and the pane actions sit flush at the pane edge.
 * - A maximized thread temporarily suppresses the logically open panel without
 *   mutating its persisted visibility, so restoring the thread restores the
 *   previous panel layout.
 */
export interface SecondaryPanelHostLayout {
  isOpen: boolean;
  /** The panel remains logically open but is hidden while a thread is full screen. */
  isSuppressed: boolean;
  /**
   * Whether the host paints its toggle over the workspace's top-right corner.
   * An open panel hosts the toggle in its own chrome, and a full-screen pane
   * hides it, so the right-edge pane headers reserve that corner only while
   * this is true. The empty-state panel has no chrome of its own, so the
   * corner toggle stays with it — otherwise no button could close it.
   */
  pinsCornerToggle: boolean;
}

export const SecondaryPanelHostLayoutContext =
  createContext<SecondaryPanelHostLayout | null>(null);
