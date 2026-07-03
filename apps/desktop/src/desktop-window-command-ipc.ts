// Main-window commands that are initiated by native desktop chrome and handled
// by the trusted React renderer.

export const BB_DESKTOP_OPEN_NEW_TAB_CHANNEL = "bb-desktop:open-new-tab";
export const BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL =
  "bb-desktop:close-window-request";
export const BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL =
  "bb-desktop:close-window-response";
// How long main waits for the renderer to answer a close request before
// closing the window itself, so a crashed, hung, or still-loading renderer
// cannot make Cmd+W inert.
export const CLOSE_WINDOW_REQUEST_TIMEOUT_MS = 1000;
