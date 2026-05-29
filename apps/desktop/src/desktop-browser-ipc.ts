// Channel names for the desktop-only web browser surface. Renderer → main
// commands drive a hardened, isolated `WebContentsView`; main → renderer pushes
// carry navigation state and popup-open requests. Mirrors the `bb-desktop:*`
// convention in `desktop-update-ipc.ts`.

export const BB_DESKTOP_BROWSER_ATTACH_CHANNEL = "bb-desktop:browser:attach";
export const BB_DESKTOP_BROWSER_DETACH_CHANNEL = "bb-desktop:browser:detach";
export const BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL =
  "bb-desktop:browser:navigate";
export const BB_DESKTOP_BROWSER_GO_BACK_CHANNEL = "bb-desktop:browser:go-back";
export const BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL =
  "bb-desktop:browser:go-forward";
export const BB_DESKTOP_BROWSER_RELOAD_CHANNEL = "bb-desktop:browser:reload";
export const BB_DESKTOP_BROWSER_STOP_CHANNEL = "bb-desktop:browser:stop";
export const BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL =
  "bb-desktop:browser:set-bounds";
export const BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL =
  "bb-desktop:browser:set-visible";
export const BB_DESKTOP_BROWSER_STATE_CHANNEL = "bb-desktop:browser:state";
export const BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL =
  "bb-desktop:browser:open-tab";
