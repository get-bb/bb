import {
  registerPanelLauncherContent,
  registerPanelTabContent,
} from "../panel/registry";
import {
  TerminalLauncherContent,
  TerminalPanelTabContent,
} from "./panel-contents";

/**
 * Workspace panel registration for the Terminal feature: the "terminal"
 * launcher (sessions of the panel's scope + Start terminal) and the
 * `terminal` tab kind. Terminal tabs stay mounted while another tab is
 * active so the attach socket and the xterm WebView survive a tab switch.
 * Imported once by `src/screens/panel/contents/index.ts`.
 */
registerPanelLauncherContent("terminal", TerminalLauncherContent);
registerPanelTabContent("terminal", TerminalPanelTabContent, {
  retainWhenInactive: true,
});
