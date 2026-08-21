/**
 * Resizable-panel bounds for the thread secondary panel.
 *
 * A leaf module: the split-workspace host, the loading placeholder and the
 * real panel all size themselves within the same bounds, and the route
 * closure must be able to read them without pulling in ThreadSecondaryPanel
 * (which loads lazily).
 */
export const THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT = 24;
export const THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT = 70;
/** The panel takes the whole group while the conversation is collapsed. */
export const CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT = 100;
