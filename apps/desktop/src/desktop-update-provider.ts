export const DESKTOP_UPDATE_RELEASE_BASE_URL =
  "https://github.com/ymichael/bb/releases/download/desktop-latest/";
export const DESKTOP_UPDATE_CHANNEL = "latest";
export const DESKTOP_UPDATE_FEED_URL = `${DESKTOP_UPDATE_RELEASE_BASE_URL}desktop-version.json`;

export interface DesktopAutoUpdateFeedConfig {
  channel: typeof DESKTOP_UPDATE_CHANNEL;
  provider: "generic";
  url: typeof DESKTOP_UPDATE_RELEASE_BASE_URL;
}

export const DESKTOP_AUTO_UPDATE_FEED_CONFIG: DesktopAutoUpdateFeedConfig = {
  channel: DESKTOP_UPDATE_CHANNEL,
  provider: "generic",
  url: DESKTOP_UPDATE_RELEASE_BASE_URL,
};
