/**
 * Registration manifest of the workspace panel contents. Importing this
 * module (the panel provider does) registers the built-in Info tab and the
 * "available on desktop/web" placeholders; features that own a tab kind add
 * one import line here for their own `register.ts` (Diff, Files / previews,
 * Terminal). Order matters only for duplicates: the last registration for a
 * kind wins, so feature registrations go after the built-ins.
 */
import { registerPanelTabContent } from "../registry";
import { UnsupportedTabContent } from "../PanelPlaceholders";
import { ThreadInfoTabContent } from "../ThreadInfoTabContent";

registerPanelTabContent("thread-info", ThreadInfoTabContent);
registerPanelTabContent("browser", UnsupportedTabContent);
registerPanelTabContent("plugin-panel", UnsupportedTabContent);
registerPanelTabContent("plugin-page-fixed", UnsupportedTabContent);

// Feature registrations (each file calls registerPanelTabContent /
// registerPanelLauncherContent at module scope):
import "@/screens/diff-tab/register"; // git-diff
import "@/screens/files/register"; // workspace / host / storage previews + "files" launcher
import "@/screens/terminal/register"; // terminal tabs + "terminal" launcher
