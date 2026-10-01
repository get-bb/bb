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

export function resolveBrowserTabPlacement(
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
  useEffect(() => {
    if (targetHostId === undefined) return;
    let current = true;
    const getTarget = desktopBrowser?.getTarget;
    if (getTarget === undefined) {
      setWindowTarget({ status: "ready", target: null });
      return;
    }
    void getTarget().then(
      (actual) => {
        if (current) setWindowTarget({ status: "ready", target: actual });
      },
      () => {
        if (current) setWindowTarget({ status: "ready", target: null });
      },
    );
    return () => {
      current = false;
    };
  }, [desktopBrowser, targetHostId, target?.instanceId, target?.generation]);

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
          if (current)
            setSavedWindowCheck({ key: savedWindowKey, status: "unknown" });
        },
      );
    return () => {
      current = false;
    };
  }, [savedWindowKey, targetHostId, savedInstanceId]);

  if (activeBrowserTab === null) {
    return null;
  }
  const savedWindowStatus =
    savedWindowCheck?.key === savedWindowKey ? savedWindowCheck.status : null;
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
        reason={
          desktopBrowser === null
            ? "desktop-required"
            : savedWindowStatus === "live"
              ? "other-window"
              : "other-connection"
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <BrowserTabContent
        key={activeBrowserTab.id}
        tabId={activeBrowserTab.id}
        desktopTarget={target}
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
  "other-connection": {
    title: "This tab isn't available in this window",
    body: "It was opened in bb on another computer or connection.",
  },
} as const;

function BrowserTabElsewhere({
  url,
  reason,
}: {
  url: string;
  reason: keyof typeof BROWSER_TAB_ELSEWHERE_COPY;
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
        <>
          <p
            className={cn(
              "max-w-full truncate font-mono text-muted-foreground select-text",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
            title={url}
          >
            {url}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
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
          </div>
        </>
      ) : null}
    </div>
  );
}
