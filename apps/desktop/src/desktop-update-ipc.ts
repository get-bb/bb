export const BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL =
  "bb-desktop:check-for-updates";
export const BB_DESKTOP_GET_INFO_CHANNEL = "bb-desktop:get-info";
export const BB_DESKTOP_INFO_CHANGED_CHANNEL = "bb-desktop:info-changed";
export const BB_DESKTOP_INSTALL_UPDATE_CHANNEL = "bb-desktop:install-update";
export const BB_DESKTOP_SET_THEME_CHANNEL = "bb-desktop:set-theme";
export const BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL =
  "bb-desktop:open-external-url";
export const BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL =
  "bb-desktop:cli-command-status";
export const BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL =
  "bb-desktop:cli-command-install";
/**
 * Whether the cli-command feature is available at all: always `app.isPackaged`.
 * Always registered (unlike the status/install channels above, which are only
 * registered when packaged) so the renderer can feature-detect and hide the
 * settings row entirely in a dev build, rather than rendering it and then
 * having its calls reject.
 */
export const BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL =
  "bb-desktop:cli-command-available";
