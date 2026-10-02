import { useEffect, useMemo, useState } from "react";
import type { BbDesktopBrowserTarget } from "@bb/desktop-contract";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { sdk } from "@/lib/sdk";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  BrowserTabContent,
  type BrowserAddressFocusRequest,
} from "./BrowserTabContent";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

interface BrowserTabDeckProps {
  browserTabs: readonly BrowserFixedPanelTab[];
  activeBrowserTabId: string | null;
  addressFocusRequest?: BrowserAddressFocusRequest | null;
  onAddressFocusRequestConsumed?: (request: BrowserAddressFocusRequest) => void;
  environmentId: string | null;
  canShowNativeBrowserView: boolean;
  canHandleBrowserCommands?: boolean;
  onNativeFocus?: () => void;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
}

export function selectActiveBrowserTab(
  browserTabs: readonly BrowserFixedPanelTab[],
  activeBrowserTabId: string | null,
): BrowserFixedPanelTab | null {
  if (activeBrowserTabId === null) {
    return null;
  }
  return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? null;
}

const WINDOW_TARGET_PENDING_ATTEMPTS = 4;
const WINDOW_CHECK_MAX_ATTEMPTS = 32;
const WINDOW_TARGET_MAX_RETRY_MS = 2000;

function windowRetryDelay(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), WINDOW_TARGET_MAX_RETRY_MS);
}

type WindowTargetCheck =
  | { status: "pending" }
  | { status: "ready"; target: BbDesktopBrowserTarget | null };

type SavedWindowCheck = {
  key: string;
  status: "live" | "gone" | "unknown";
};

type BrowserTabPlacement =
  | "open"
  | "attach"
  | "check-saved-window"
  | "pending"
  | "unavailable";

function resolveBrowserTabPlacement(
  saved: BbDesktopBrowserTarget | undefined,
  windowTarget: WindowTargetCheck,
): BrowserTabPlacement {
  if (saved === undefined) return "open";
  if (windowTarget.status === "pending") return "pending";
  const actual = windowTarget.target;
  if (actual === null || actual.hostId !== saved.hostId) return "unavailable";
  return actual.instanceId === saved.instanceId
    ? "attach"
    : "check-saved-window";
}

export function BrowserTabDeck({
  browserTabs,
  activeBrowserTabId,
  addressFocusRequest = null,
  onAddressFocusRequestConsumed,
  environmentId,
  canShowNativeBrowserView,
  canHandleBrowserCommands = canShowNativeBrowserView,
  onNativeFocus,
  threadId,
  onUpdate,
}: BrowserTabDeckProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const visibilityCoordinator = useMemo(
    () =>
      desktopBrowser === null
        ? null
        : createBrowserViewVisibilityCoordinator(desktopBrowser),
    [desktopBrowser],
  );

  const activeBrowserTab = selectActiveBrowserTab(
    browserTabs,
    activeBrowserTabId,
  );
  const target = activeBrowserTab?.desktopTarget;
  const targetHostId = target?.hostId;
  const [windowTarget, setWindowTarget] = useState<WindowTargetCheck>({
    status: "pending",
  });
  const [checkRound, setCheckRound] = useState(0);
  const checkKey =
    target === undefined
      ? null
      : `${checkRound}:${target.hostId}:${target.instanceId}:${target.generation}`;
  const [stoppedCheckKey, setStoppedCheckKey] = useState<string | null>(null);
  useEffect(() => {
    if (targetHostId === undefined) return;
    const getTarget = desktopBrowser?.getTarget?.bind(desktopBrowser);
    if (getTarget === undefined) {
      setWindowTarget({ status: "ready", target: null });
      return;
    }
    let current = true;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      void getTarget()
        .catch(() => null)
        .then((actual) => {
          if (!current) return;
          if (actual !== null) {
            setWindowTarget({ status: "ready", target: actual });
            return;
          }
          attempt += 1;
          if (attempt >= WINDOW_TARGET_PENDING_ATTEMPTS)
            setWindowTarget({ status: "ready", target: null });
          if (attempt >= WINDOW_CHECK_MAX_ATTEMPTS) {
            setStoppedCheckKey(checkKey);
            return;
          }
          retry = setTimeout(check, windowRetryDelay(attempt));
        });
    };
    check();
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, [
    desktopBrowser,
    targetHostId,
    target?.instanceId,
    target?.generation,
    checkKey,
  ]);

  const placement = resolveBrowserTabPlacement(target, windowTarget);
  const savedWindowKey =
    placement === "check-saved-window" && target !== undefined
      ? `${target.hostId}:${target.instanceId}`
      : null;
  const [savedWindowCheck, setSavedWindowCheck] =
    useState<SavedWindowCheck | null>(null);
  const savedInstanceId = target?.instanceId;
  useEffect(() => {
    if (
      savedWindowKey === null ||
      targetHostId === undefined ||
      savedInstanceId === undefined
    )
      return;
    let current = true;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      void sdk.experimental_desktopBrowsers
        .listInstances({ hostId: targetHostId })
        .then(
          ({ instances }) => {
            if (!current) return;
            const live = instances.some(
              (instance) => instance.instanceId === savedInstanceId,
            );
            setSavedWindowCheck({
              key: savedWindowKey,
              status: live ? "live" : "gone",
            });
          },
          () => {
            if (!current) return;
            attempt += 1;
            if (attempt >= WINDOW_TARGET_PENDING_ATTEMPTS)
              setSavedWindowCheck({ key: savedWindowKey, status: "unknown" });
            if (attempt >= WINDOW_CHECK_MAX_ATTEMPTS) {
              setStoppedCheckKey(checkKey);
              return;
            }
            retry = setTimeout(check, windowRetryDelay(attempt));
          },
        );
    };
    check();
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, [savedWindowKey, targetHostId, savedInstanceId, checkKey]);

  if (activeBrowserTab === null) {
    return null;
  }
  const savedWindowStatus =
    savedWindowCheck?.key === savedWindowKey ? savedWindowCheck.status : null;
  const checksStopped = checkKey !== null && stoppedCheckKey === checkKey;
  if (
    placement === "pending" ||
    (placement === "check-saved-window" && savedWindowStatus === null)
  ) {
    return <div className="flex min-h-0 flex-1 bg-sidebar" />;
  }
  if (
    placement === "unavailable" ||
    (placement === "check-saved-window" && savedWindowStatus !== "gone")
  ) {
    return (
      <BrowserTabElsewhere
        url={activeBrowserTab.url}
        onRetry={
          checksStopped ? () => setCheckRound((round) => round + 1) : null
        }
        reason={
          desktopBrowser === null
            ? "desktop-required"
            : savedWindowStatus === "live"
              ? "other-window"
              : windowTarget.status === "ready" &&
                  windowTarget.target !== null &&
                  windowTarget.target.hostId !== target?.hostId
                ? "other-computer"
                : checksStopped
                  ? "unreachable"
                  : "reconnecting"
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <BrowserTabContent
        key={activeBrowserTab.id}
        tabId={activeBrowserTab.id}
        existingOnly={placement === "attach" ? true : undefined}
        initialUrl={activeBrowserTab.url}
        addressFocusRequest={
          addressFocusRequest?.tabId === activeBrowserTab.id
            ? addressFocusRequest
            : null
        }
        onAddressFocusRequestConsumed={onAddressFocusRequestConsumed}
        canShowNativeBrowserView={canShowNativeBrowserView}
        canHandleBrowserCommands={canHandleBrowserCommands}
        onNativeFocus={onNativeFocus}
        visibilityCoordinator={visibilityCoordinator}
        environmentId={environmentId}
        threadId={threadId}
        onUpdate={onUpdate}
      />
    </div>
  );
}

const BROWSER_TAB_ELSEWHERE_COPY = {
  "desktop-required": {
    title: "Browser tabs need the desktop app",
    body: "This tab is open in the bb desktop app.",
  },
  "other-window": {
    title: "This tab is open in another bb window",
    body: "Switch to that window to keep browsing.",
  },
  "other-computer": {
    title: "This tab is open on another computer",
    body: "It was opened in bb on a different computer.",
  },
  reconnecting: {
    title: "Reconnecting to this tab",
    body: "bb can't reach this computer's browser right now. The tab opens once it reconnects.",
  },
  unreachable: {
    title: "Can't reach this tab",
    body: "bb couldn't reach this computer's browser. Try again once bb has reconnected.",
  },
} as const;

function BrowserTabElsewhere({
  url,
  reason,
  onRetry,
}: {
  url: string;
  reason: keyof typeof BROWSER_TAB_ELSEWHERE_COPY;
  onRetry: (() => void) | null;
}) {
  const copy = BROWSER_TAB_ELSEWHERE_COPY[reason];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <div className="text-sm font-medium text-foreground">{copy.title}</div>
      <p
        className={cn(
          "max-w-xs text-muted-foreground",
          COARSE_POINTER_TEXT_SM_CLASS,
        )}
      >
        {copy.body}
      </p>
      {url.length > 0 ? (
        <p
          className={cn(
            "max-w-full truncate font-mono text-muted-foreground select-text",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
          title={url}
        >
          {url}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry !== null ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <Icon name="RotateCcw" aria-hidden />
            Try again
          </Button>
        ) : null}
        {url.length > 0 ? (
          <>
            <Button
              type="button"
              variant={onRetry !== null ? "ghost" : "outline"}
              size="sm"
              onClick={() => openUrlInExternalBrowser(url)}
            >
              <Icon name="ExternalLink" aria-hidden />
              Open in browser
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void copyToClipboardWithToast(url, {
                  successMessage: "Link copied",
                });
              }}
            >
              <Icon name="Copy" aria-hidden />
              Copy link
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
