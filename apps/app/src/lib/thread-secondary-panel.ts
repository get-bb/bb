/**
 * The typed fixed-view union of the thread secondary panel: the views
 * toggled from the panel chrome rather than opened as closable file tabs.
 * Plugin panels are NOT fixed views — a `threadPanelAction` opens them as
 * regular file-strip tabs (see PluginPanelFixedPanelTab).
 */
export type ThreadSecondaryPanel = "git-diff" | "thread-info";
