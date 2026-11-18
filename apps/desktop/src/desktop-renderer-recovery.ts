import type {
  Event,
  RenderProcessGoneDetails,
  WebContentsWillNavigateEventParams,
} from "electron";
import { createLocalViewUrl } from "./local-view.js";

export const RENDERER_RELOAD_DELAYS_MS = [500, 2_000, 8_000] as const;
export const RENDERER_CRASH_WINDOW_MS = 5 * 60_000;
export const CRASH_PAGE_RELOAD_URL = "https://reload.bb-desktop.invalid/";

type RendererGoneReason = RenderProcessGoneDetails["reason"];

const UNRECOVERABLE_REASONS: ReadonlySet<RendererGoneReason> = new Set([
  "launch-failed",
  "integrity-failure",
]);

const REASON_DESCRIPTIONS: Record<RendererGoneReason, string> = {
  "abnormal-exit": "exited unexpectedly",
  "clean-exit": "exited unexpectedly",
  crashed: "crashed",
  "integrity-failure": "failed a code integrity check",
  killed: "was stopped by the system",
  "launch-failed": "could not start",
  "memory-eviction": "was closed to free memory",
  oom: "ran out of memory",
};

export interface RecoverableWebContents {
  getURL(): string;
  isCrashed(): boolean;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  reload(): void;
  on(
    event: "render-process-gone",
    listener: (event: Event, details: RenderProcessGoneDetails) => void,
  ): this;
  on(event: "did-navigate", listener: () => void): this;
  on(
    event: "will-navigate",
    listener: (event: Event<WebContentsWillNavigateEventParams>) => void,
  ): this;
  once(event: "destroyed", listener: () => void): this;
}

interface RendererRecoveryLogger {
  error(message: string): void;
  warn(message: string): void;
}

export interface WatchRendererCrashesArgs {
  describeWindow: () => string;
  logger: RendererRecoveryLogger;
  onRendererGone: () => void;
  webContents: RecoverableWebContents;
}

export interface RendererCrashRecovery {
  restoreCrashPage(): boolean;
}

function describeUrlForLog(url: string): string {
  if (url.length === 0) return "no page";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "data:") return "a local page";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "an unparseable URL";
  }
}

function crashPageUrl(
  reason: RendererGoneReason,
  automaticReloads: number,
): string {
  const cause = `Its page ${REASON_DESCRIPTIONS[reason]}`;
  const details =
    automaticReloads === 0
      ? `${cause}.`
      : `${cause} again after bb reloaded it ${automaticReloads === 1 ? "once" : `${automaticReloads} times`}.`;
  return createLocalViewUrl({
    viewModel: {
      details,
      kind: "renderer-crash",
      reloadHref: CRASH_PAGE_RELOAD_URL,
      title: "This window stopped working",
    },
  });
}

export function watchRendererCrashes(
  args: WatchRendererCrashesArgs,
): RendererCrashRecovery {
  const { describeWindow, logger, webContents } = args;
  let crashTimes: number[] = [];
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let crashPage: { crashedUrl: string } | null = null;

  function clearReloadTimer(): void {
    if (reloadTimer !== null) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  }

  function restoreCrashedPage(crashedUrl: string): void {
    crashPage = null;
    crashTimes = [];
    if (webContents.isDestroyed()) return;
    webContents.loadURL(crashedUrl).catch((error: unknown) => {
      logger.warn(
        `[desktop] ${describeWindow()} could not reload ${describeUrlForLog(crashedUrl)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  function showCrashPage(
    crashedUrl: string,
    reason: RendererGoneReason,
    automaticReloads: number,
  ): void {
    webContents
      .loadURL(crashPageUrl(reason, automaticReloads))
      .then(() => {
        crashPage = { crashedUrl };
      })
      .catch((error: unknown) => {
        logger.warn(
          `[desktop] ${describeWindow()} could not show the crash page: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  webContents.on("render-process-gone", (_event, details) => {
    if (webContents.isDestroyed()) return;
    clearReloadTimer();
    const crashedUrl = crashPage?.crashedUrl ?? webContents.getURL();
    crashPage = null;
    const now = Date.now();
    crashTimes = [
      ...crashTimes.filter((time) => now - time < RENDERER_CRASH_WINDOW_MS),
      now,
    ];
    const automaticReloads = crashTimes.length - 1;
    const delayMs = UNRECOVERABLE_REASONS.has(details.reason)
      ? undefined
      : RENDERER_RELOAD_DELAYS_MS[automaticReloads];
    const gone = `[desktop] ${describeWindow()} renderer gone (reason ${details.reason}, exit code ${details.exitCode}) on ${describeUrlForLog(crashedUrl)}`;
    args.onRendererGone();
    if (crashedUrl.length === 0) {
      logger.warn(`${gone}; nothing to reload`);
      return;
    }
    if (delayMs === undefined) {
      logger.error(`${gone}; showing the crash page`);
      showCrashPage(crashedUrl, details.reason, automaticReloads);
      return;
    }
    logger.error(
      `${gone}; reloading in ${delayMs} ms (attempt ${automaticReloads + 1} of ${RENDERER_RELOAD_DELAYS_MS.length})`,
    );
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!webContents.isDestroyed() && webContents.isCrashed()) {
        webContents.reload();
      }
    }, delayMs);
  });

  webContents.on("did-navigate", () => {
    clearReloadTimer();
    crashPage = null;
  });

  webContents.on("will-navigate", (event) => {
    if (crashPage !== null && event.url === CRASH_PAGE_RELOAD_URL) {
      event.preventDefault();
      restoreCrashedPage(crashPage.crashedUrl);
    }
  });

  webContents.once("destroyed", clearReloadTimer);

  return {
    restoreCrashPage() {
      if (crashPage === null) return false;
      restoreCrashedPage(crashPage.crashedUrl);
      return true;
    },
  };
}
