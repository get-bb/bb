/**
 * Facts shown in the About dialog. Everything here is either injected at build
 * time (version, channel, commit, build date, plugin SDK version) or read from
 * the running process, so a bug report can be reproduced against the exact
 * build the user is running.
 */
export interface DesktopAboutFacts {
  applicationName: string;
  /** ISO 8601 timestamp of when the build was produced. */
  buildDate: string;
  channel: "latest" | "nightly";
  /** Full git SHA, or empty when the build had no git metadata. */
  commit: string;
  electronVersion: string;
  osArch: string;
  osRelease: string;
  /** `os.type()`, e.g. "Darwin" or "Linux". */
  osType: string;
  platform: NodeJS.Platform;
  pluginSdkVersion: string;
  version: string;
}

export interface DesktopAboutPanelOptions {
  applicationName: string;
  applicationVersion: string;
  credits?: string;
}

export interface DesktopAboutDialogOptions {
  buttons: string[];
  cancelId: number;
  /** Index into `buttons` whose click should copy `detail` to the clipboard. */
  copyButtonId: number;
  defaultId: number;
  detail: string;
  message: string;
  type: "info";
}

export const ABOUT_DIALOG_COPY_BUTTON_LABEL = "Copy";
const ABOUT_DIALOG_DISMISS_BUTTON_LABEL = "OK";
const UNKNOWN_VALUE = "unknown";
const MILLISECONDS_PER_DAY = 86_400_000;

function displayValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? UNKNOWN_VALUE : trimmed;
}

/**
 * How stale the running build is, in the "3 days old" form. Returns null for an
 * unparseable build date so the Date line degrades to the raw value instead of
 * claiming an age it cannot know.
 */
export function formatBuildAge(
  buildDate: string,
  nowMs: number,
): string | null {
  const buildMs = Date.parse(buildDate);
  if (Number.isNaN(buildMs)) {
    return null;
  }
  // A build that reads as newer than the clock means skew, not a future
  // release; report it as fresh rather than as a negative age.
  const days = Math.max(
    0,
    Math.floor((nowMs - buildMs) / MILLISECONDS_PER_DAY),
  );
  if (days === 0) {
    return "today";
  }
  return days === 1 ? "1 day old" : `${days} days old`;
}

function formatBuildDate(buildDate: string, nowMs: number | null): string {
  const trimmed = buildDate.trim();
  if (trimmed.length === 0) {
    return UNKNOWN_VALUE;
  }
  if (nowMs === null) {
    return trimmed;
  }
  const age = formatBuildAge(trimmed, nowMs);
  return age === null ? trimmed : `${trimmed} (${age})`;
}

/**
 * The detail block a user copies into a bug report, one `Label: value` per
 * line, most build-identifying first. Pass null for `nowMs` where the block is
 * rendered once and read later — a build age frozen at launch would be wrong by
 * the time a long-running session reads it.
 */
export function buildDesktopAboutDetails(
  facts: DesktopAboutFacts,
  nowMs: number | null,
): string {
  const lines: [string, string][] = [
    ["Version", facts.version],
    ["Build Type", facts.channel === "nightly" ? "Nightly" : "Stable"],
    ["Commit", facts.commit],
    ["Date", formatBuildDate(facts.buildDate, nowMs)],
    ["Plugin SDK", facts.pluginSdkVersion],
    ["Electron", facts.electronVersion],
    ["OS", `${facts.osType} ${facts.osArch} ${facts.osRelease}`],
  ];
  return lines
    .map(([label, value]) => `${label}: ${displayValue(value)}`)
    .join("\n");
}

/**
 * The About dialog shown from the app menu. It replaces the native About panel
 * because only a message box can carry a Copy button, and the whole point of
 * the detail block is pasting it into a bug report.
 */
export function createDesktopAboutDialogOptions(
  facts: DesktopAboutFacts,
  nowMs: number,
): DesktopAboutDialogOptions {
  return {
    buttons: [
      ABOUT_DIALOG_DISMISS_BUTTON_LABEL,
      ABOUT_DIALOG_COPY_BUTTON_LABEL,
    ],
    cancelId: 0,
    copyButtonId: 1,
    defaultId: 0,
    detail: buildDesktopAboutDetails(facts, nowMs),
    message: facts.applicationName,
    type: "info",
  };
}

/**
 * The native panel stays populated for any path that opens it without going
 * through the app menu. Electron accepts these options once at startup, so it
 * omits the build age.
 */
export function createDesktopAboutPanelOptions(
  facts: DesktopAboutFacts,
): DesktopAboutPanelOptions {
  const details = buildDesktopAboutDetails(facts, null);

  // `credits` is macOS/Windows only. The GTK about dialog has no equivalent
  // free-text field, so Linux gets the details under the version instead of
  // silently dropping them.
  if (facts.platform === "linux") {
    return {
      applicationName: facts.applicationName,
      applicationVersion: `${facts.version}\n\n${details}`,
    };
  }

  return {
    applicationName: facts.applicationName,
    applicationVersion: facts.version,
    credits: details,
  };
}
