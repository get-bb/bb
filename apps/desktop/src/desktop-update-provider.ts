import {
  createBbDesktopVersionFeedFileName,
  type BbDesktopInfo,
} from "@bb/desktop-contract";

type DesktopReleaseChannel = "latest" | "nightly";

interface DesktopReleaseInfo {
  applicationName: "bb" | "bb Nightly";
  channel: DesktopReleaseChannel;
  iconFileName: "icon.png" | "icon-nightly.png";
  releaseTag: "desktop-latest" | "desktop-nightly";
  updateReleaseBaseUrl: string;
  windowsReleaseTag: "desktop-win-latest" | "desktop-win-nightly";
  windowsUpdateReleaseBaseUrl: string;
}

export function createDesktopReleaseInfo(
  channel: DesktopReleaseChannel,
): DesktopReleaseInfo {
  const nightly = channel === "nightly";
  const releaseTag = nightly ? "desktop-nightly" : "desktop-latest";
  const windowsReleaseTag = nightly
    ? "desktop-win-nightly"
    : "desktop-win-latest";

  return {
    applicationName: nightly ? "bb Nightly" : "bb",
    channel,
    iconFileName: nightly ? "icon-nightly.png" : "icon.png",
    releaseTag,
    updateReleaseBaseUrl: `https://github.com/get-bb/bb/releases/download/${releaseTag}/`,
    windowsReleaseTag,
    windowsUpdateReleaseBaseUrl: `https://github.com/get-bb/bb/releases/download/${windowsReleaseTag}/`,
  };
}

function resolveBuiltDesktopReleaseChannel(
  rawChannel: string | undefined,
): DesktopReleaseChannel {
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (rawChannel === "latest" || rawChannel === "nightly") {
    return rawChannel;
  }

  throw new Error(
    `Built desktop release channel must be latest or nightly, got ${String(rawChannel)}.`,
  );
}

export const DESKTOP_RELEASE_CHANNEL = resolveBuiltDesktopReleaseChannel(
  process.env.BB_DESKTOP_RELEASE_CHANNEL,
);
export const DESKTOP_RELEASE_INFO = createDesktopReleaseInfo(
  DESKTOP_RELEASE_CHANNEL,
);
const DESKTOP_UPDATE_RELEASE_BASE_URL =
  DESKTOP_RELEASE_INFO.updateReleaseBaseUrl;

export function createDesktopUpdateFeedUrlForChannel(
  platform: BbDesktopInfo["platform"],
  channel: DesktopReleaseChannel,
): string {
  const releaseInfo = createDesktopReleaseInfo(channel);
  if (platform === "windows") {
    return releaseInfo.windowsUpdateReleaseBaseUrl;
  }
  return `${releaseInfo.updateReleaseBaseUrl}${createBbDesktopVersionFeedFileName(platform)}`;
}

export function createDesktopUpdateFeedUrl(
  platform: BbDesktopInfo["platform"],
): string {
  return createDesktopUpdateFeedUrlForChannel(
    platform,
    DESKTOP_RELEASE_CHANNEL,
  );
}

export interface DesktopAutoUpdateFeedConfig {
  channel: DesktopReleaseChannel;
  provider: "generic";
  url: string;
}

export function createDesktopAutoUpdateFeedConfigForChannel(
  platform: BbDesktopInfo["platform"],
  channel: DesktopReleaseChannel,
): DesktopAutoUpdateFeedConfig {
  const releaseInfo = createDesktopReleaseInfo(channel);
  return {
    channel,
    provider: "generic",
    url:
      platform === "windows"
        ? releaseInfo.windowsUpdateReleaseBaseUrl
        : releaseInfo.updateReleaseBaseUrl,
  };
}

export function createDesktopAutoUpdateFeedConfig(
  platform: BbDesktopInfo["platform"],
): DesktopAutoUpdateFeedConfig {
  return createDesktopAutoUpdateFeedConfigForChannel(
    platform,
    DESKTOP_RELEASE_CHANNEL,
  );
}

export const DESKTOP_AUTO_UPDATE_FEED_CONFIG: DesktopAutoUpdateFeedConfig = {
  channel: DESKTOP_RELEASE_CHANNEL,
  provider: "generic",
  url: DESKTOP_UPDATE_RELEASE_BASE_URL,
};

interface DesktopUpdateSupport {
  autoUpdate: boolean;
  versionCheck: boolean;
}

interface ResolveDesktopUpdateSupportArgs {
  canReplaceAppImage: (appImagePath: string) => boolean;
  env: NodeJS.ProcessEnv;
  platform: BbDesktopInfo["platform"];
}

export function resolveDesktopUpdateSupport(
  args: ResolveDesktopUpdateSupportArgs,
): DesktopUpdateSupport {
  if (args.platform === "macos") {
    return { autoUpdate: true, versionCheck: true };
  }

  if (args.platform === "windows") {
    return { autoUpdate: true, versionCheck: false };
  }

  const appImagePath = args.env.APPIMAGE?.trim() ?? "";
  if (appImagePath.length === 0) {
    return { autoUpdate: false, versionCheck: true };
  }

  return {
    autoUpdate: args.canReplaceAppImage(appImagePath),
    versionCheck: true,
  };
}
