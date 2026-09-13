import semver from "semver";
import {
  bbDesktopVersionFeedSchema,
  type BbDesktopInfo,
  type BbDesktopVersionFeed,
} from "@bb/desktop-contract";
import {
  createDesktopUpdateScheduler,
  type DesktopUpdateService,
} from "./desktop-update-scheduler.js";

export const DESKTOP_UPDATE_CHECK_TIMEOUT_MS = 5_000;

interface DesktopUpdateLogger {
  warn(message: string): void;
}

interface ParseDesktopVersionFeedArgs {
  channel: BbDesktopVersionFeed["channel"];
  checkedAt: string;
  currentVersion: string;
  payloadText: string;
  platform: BbDesktopInfo["platform"];
}

interface ValidDesktopVersionFeedParseResult {
  feed: BbDesktopVersionFeed;
  info: BbDesktopInfo;
  kind: "valid";
}

interface MalformedDesktopVersionFeedParseResult {
  kind: "malformed";
  reason: string;
}

type DesktopVersionFeedParseResult =
  | MalformedDesktopVersionFeedParseResult
  | ValidDesktopVersionFeedParseResult;

interface CreateDesktopUpdateServiceArgs {
  channel: BbDesktopVersionFeed["channel"];
  currentVersion: string;
  enabled: boolean;
  feedUrl: string;
  fetchImpl?: typeof fetch;
  logger: DesktopUpdateLogger;
  now?: () => number;
  platform: BbDesktopInfo["platform"];
}

interface FetchDesktopVersionFeedArgs {
  feedUrl: string;
  fetchImpl: typeof fetch;
}

interface ApplyFailureArgs {
  checkedAt: string;
  message: string;
}

function createBaseInfo(
  currentVersion: string,
  platform: BbDesktopInfo["platform"],
): BbDesktopInfo {
  return {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform,
    updateAvailable: false,
    updateDownloaded: false,
    version: currentVersion,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseDesktopVersionFeed(
  args: ParseDesktopVersionFeedArgs,
): DesktopVersionFeedParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(args.payloadText);
  } catch (error) {
    return {
      kind: "malformed",
      reason: `The desktop version feed was not valid JSON: ${formatErrorMessage(
        error,
      )}`,
    };
  }

  const parsedFeed = bbDesktopVersionFeedSchema.safeParse(payload);
  if (!parsedFeed.success) {
    return {
      kind: "malformed",
      reason: `The desktop version feed did not match schema: ${parsedFeed.error.message}`,
    };
  }

  if (parsedFeed.data.platform !== args.platform) {
    return {
      kind: "malformed",
      reason: `The desktop version feed is for another platform: expected ${args.platform}, got ${parsedFeed.data.platform}`,
    };
  }
  if (parsedFeed.data.channel !== args.channel) {
    return {
      kind: "malformed",
      reason: `The desktop version feed is for another channel: expected ${args.channel}, got ${parsedFeed.data.channel}`,
    };
  }

  const parsedCurrentVersion = semver.parse(args.currentVersion);
  const parsedFeedVersion = semver.parse(parsedFeed.data.version);
  if (parsedCurrentVersion === null || parsedFeedVersion === null) {
    return {
      kind: "malformed",
      reason: `The desktop version feed contained an invalid version: current=${args.currentVersion} feed=${parsedFeed.data.version}`,
    };
  }

  return {
    feed: parsedFeed.data,
    info: {
      lastCheckedAt: args.checkedAt,
      latestVersion: parsedFeed.data.version,
      pendingVersion: null,
      platform: args.platform,
      updateAvailable: semver.gt(parsedFeedVersion, parsedCurrentVersion),
      updateDownloaded: false,
      version: args.currentVersion,
    },
    kind: "valid",
  };
}

async function fetchDesktopVersionFeed(
  args: FetchDesktopVersionFeedArgs,
): Promise<string> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    DESKTOP_UPDATE_CHECK_TIMEOUT_MS,
  );

  try {
    const response = await args.fetchImpl(args.feedUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function createDesktopUpdateService(
  args: CreateDesktopUpdateServiceArgs,
): DesktopUpdateService {
  const fetchImpl = args.fetchImpl ?? fetch;
  const scheduler = createDesktopUpdateScheduler({
    enabled: args.enabled,
    initialInfo: createBaseInfo(args.currentVersion, args.platform),
    now: args.now ?? (() => Date.now()),
    runCheck,
  });

  function applyFailure(failureArgs: ApplyFailureArgs): void {
    args.logger.warn(failureArgs.message);
    scheduler.updateInfo({
      ...scheduler.getInfo(),
      lastCheckedAt: failureArgs.checkedAt,
    });
  }

  async function runCheck(checkedAt: string): Promise<void> {
    let payloadText: string;
    try {
      payloadText = await fetchDesktopVersionFeed({
        feedUrl: args.feedUrl,
        fetchImpl,
      });
    } catch (error) {
      applyFailure({
        checkedAt,
        message: `Desktop update check network failure; preserving session state, and update prompts stay disabled without a valid prior feed: ${formatErrorMessage(
          error,
        )}`,
      });
      return;
    }

    const parsed = parseDesktopVersionFeed({
      channel: args.channel,
      checkedAt,
      currentVersion: args.currentVersion,
      payloadText,
      platform: args.platform,
    });
    if (parsed.kind === "malformed") {
      applyFailure({
        checkedAt,
        message: `Desktop update check malformed feed; ignoring response and keeping prior valid session state, with update prompts disabled if none exists: ${parsed.reason}`,
      });
      return;
    }

    if (semver.lt(parsed.feed.version, args.currentVersion)) {
      args.logger.warn(
        `Desktop update check saw a lower feed version; downgrade feeds never trigger desktop update prompts: current=${args.currentVersion} feed=${parsed.feed.version}`,
      );
    }
    scheduler.updateInfo(parsed.info);
  }

  return scheduler;
}
