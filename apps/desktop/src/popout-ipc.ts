// Channel names for the desktop-only popout chat surface. Renderer → main
// commands are fire-and-forget; main → renderer pushes the currently adopted
// thread, or null for the quick-ask state.

export const BB_DESKTOP_POPOUT_TOGGLE_CHANNEL = "bb-desktop:popout:toggle";
export const BB_DESKTOP_POPOUT_SET_THREAD_CHANNEL =
  "bb-desktop:popout:set-thread";
export const BB_DESKTOP_POPOUT_OPEN_IN_MAIN_CHANNEL =
  "bb-desktop:popout:open-in-main";
export const BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL =
  "bb-desktop:popout:thread-changed";
export const BB_DESKTOP_POPOUT_RESIZE_CHANNEL = "bb-desktop:popout:resize";
