import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
  BbDesktopBrowserViewportBounds,
  BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import { clampBbDesktopBrowserViewBounds } from "@bb/desktop-contract";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { Icon } from "@/components/ui/icon.js";
import { getBbDesktopInfo, getDesktopBrowserApi } from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";
import {
  getBrowserUrlSecurity,
  resolveBrowserAddressInput,
} from "@/lib/browser-url";
import { useBrowserHistory } from "@/lib/browser-history";
import { BROWSER_VIEW_BOUNDS_SYNC_EVENT } from "@/lib/browser-view-bounds-sync";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import { BrowserNewTabScreen } from "./BrowserNewTabScreen";
import {
  registerBrowserView,
  type BrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

export interface BrowserTabContentProps {
  tabId: string;
  initialUrl: string;
  /**
   * Whether this browser tab is the visible, active panel tab. The native view
   * stays attached (and its page intact) across deactivation; only its
   * visibility follows this flag, so switching tabs never destroys/reloads it.
   */
  isActive: boolean;
  /**
   * Deck-owned coordinator that serializes view visibility so the previously
   * shown view is always hidden before this one is shown (no two native overlays
   * visible at once). Null on the web build, where there is no native view.
   */
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  environmentId: string | null;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
}

interface BrowserChromeProps {
  addressDraft: string;
  isEditing: boolean;
  state: BbDesktopBrowserState | null;
  currentUrl: string;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onOpenExternal: () => void;
}

interface NavButtonProps {
  icon: "ChevronLeft" | "ChevronRight" | "RotateCcw" | "X" | "ExternalLink";
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

interface BrowserViewBoundsFromElementArgs {
  element: HTMLElement;
}

interface BrowserViewBoundsEqualArgs {
  a: BbDesktopBrowserViewBounds;
  b: BbDesktopBrowserViewBounds;
}

interface SyncBrowserViewPlacementArgs {
  force: boolean;
}

const EMPTY_BROWSER_VIEW_BOUNDS: BbDesktopBrowserViewBounds = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

function roundedBoundsFromRect(rect: DOMRect): BbDesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function browserViewportBounds(): BbDesktopBrowserViewportBounds {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Measure the panel rect the native view must overlay, in the renderer's
 * layout coordinate space. This rect is the single placement authority: it is
 * pushed over IPC whenever it changes, at the renderer's own layout cadence
 * (ResizeObserver ticks, window resizes, explicit layout-sync events), so the
 * native overlay always lands where the chrome around it is painted. The
 * desktop main process never extrapolates placement on its own: during native
 * window resize bursts — where no bounds protocol can keep the independently
 * composited overlay glued to the lagging chrome — it hides the view outright
 * and reveals it at the latest pushed rect (clamped to the live window) once
 * the resize settles.
 */
function browserViewBoundsFromElement(
  args: BrowserViewBoundsFromElementArgs,
): BbDesktopBrowserViewBounds {
  return clampBbDesktopBrowserViewBounds({
    bounds: roundedBoundsFromRect(args.element.getBoundingClientRect()),
    viewport: browserViewportBounds(),
  });
}

function browserViewBoundsEqual(args: BrowserViewBoundsEqualArgs): boolean {
  return (
    args.a.x === args.b.x &&
    args.a.y === args.b.y &&
    args.a.width === args.b.width &&
    args.a.height === args.b.height
  );
}

function NavButton({ icon, label, disabled, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex shrink-0 items-center justify-center text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
      )}
    >
      <Icon name={icon} aria-hidden />
    </button>
  );
}

function BrowserChrome({
  addressDraft,
  isEditing,
  state,
  currentUrl,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onSubmit,
  onBack,
  onForward,
  onReloadOrStop,
  onOpenExternal,
}: BrowserChromeProps) {
  const isLoading = state?.isLoading ?? false;
  const security = getBrowserUrlSecurity(currentUrl);
  const addressValue = isEditing ? addressDraft : currentUrl;

  return (
    <div
      data-testid="browser-tab-nav-bar"
      className={`relative flex items-center gap-1 border-b border-border-seam ${SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS} px-2 py-1.5`}
    >
      <NavButton
        icon="ChevronLeft"
        label="Go back"
        disabled={!(state?.canGoBack ?? false)}
        onClick={onBack}
      />
      <NavButton
        icon="ChevronRight"
        label="Go forward"
        disabled={!(state?.canGoForward ?? false)}
        onClick={onForward}
      />
      <NavButton
        icon={isLoading ? "X" : "RotateCcw"}
        label={isLoading ? "Stop loading" : "Reload"}
        onClick={onReloadOrStop}
      />
      <form onSubmit={onSubmit} className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3 max-md:pointer-coarse:h-10">
          {security === "secure" ? (
            <Icon
              name="Lock"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                "text-success",
              )}
              aria-label="Secure connection"
            />
          ) : security === "insecure" ? (
            <Icon
              name="AlertTriangle"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                "text-warning",
              )}
              aria-label="Connection not secure"
            />
          ) : (
            <Icon
              name="Search"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                "text-muted-foreground",
              )}
              aria-hidden
            />
          )}
          <input
            type="text"
            value={addressValue}
            onChange={(event) => onAddressChange(event.target.value)}
            onFocus={onAddressFocus}
            onBlur={onAddressBlur}
            placeholder="Enter a URL"
            aria-label="Address and search bar"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "min-w-0 flex-1 bg-transparent font-mono text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          />
        </div>
      </form>
      <NavButton
        icon="ExternalLink"
        label="Open in external browser"
        disabled={currentUrl.length === 0}
        onClick={onOpenExternal}
      />
      {isLoading ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <span className="block h-full w-1/3 animate-pulse bg-ring" />
        </span>
      ) : null}
    </div>
  );
}

function BrowserUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <div className="text-sm font-medium text-foreground">
        Browser tabs need the desktop app
      </div>
      <p
        className={cn(
          "max-w-xs text-muted-foreground",
          COARSE_POINTER_TEXT_SM_CLASS,
        )}
      >
        The in-app web browser runs in the bb desktop app. Open this thread
        there to browse the web.
      </p>
    </div>
  );
}

export function BrowserTabContent({
  tabId,
  initialUrl,
  isActive,
  visibilityCoordinator,
  environmentId,
  threadId,
  onUpdate,
}: BrowserTabContentProps) {
  const desktopBrowser = useMemo<BbDesktopBrowserApi | null>(
    () => getDesktopBrowserApi(),
    [],
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const {
    entries: recent,
    recordVisit,
    clear: clearRecent,
  } = useBrowserHistory(threadId);

  const [state, setState] = useState<BbDesktopBrowserState | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(false);
  // Bitmap stand-in pushed by the desktop main process while the native view
  // is hidden during a native window resize; null outside resize bursts.
  const [resizeSnapshotUrl, setResizeSnapshotUrl] = useState<string | null>(
    null,
  );

  // Keep the latest persistence/visit callbacks in refs so the attach effect can
  // run once per tab without re-subscribing when these identities change.
  const onUpdateRef = useRef(onUpdate);
  const recordVisitRef = useRef(recordVisit);
  onUpdateRef.current = onUpdate;
  recordVisitRef.current = recordVisit;
  // The URL to load when the view is first created. Captured once so navigation
  // (which updates the persisted `initialUrl` prop) never re-runs the attach
  // effect — and the live view keeps its page across tab switches.
  const initialUrlRef = useRef(initialUrl);
  // Mount-time active state, read by the create-once attach effect without
  // re-running it when activeness later changes (the visibility effect owns that).
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const hasPage = currentUrl.length > 0;
  // A blocking modal (e.g. the git-action dialog) dims the panel with a DOM
  // backdrop the native browser overlay cannot sit behind. While one is open,
  // hide the view and fall back to the DOM new-tab screen so the backdrop dims
  // the whole panel.
  const isBrowserDimmingModalOpen = useIsBrowserDimmingModalOpen();
  const lastSentBoundsRef = useRef<BbDesktopBrowserViewBounds | null>(null);

  const readBounds = useCallback(() => {
    const element = contentRef.current;
    if (element === null) {
      return null;
    }
    return browserViewBoundsFromElement({ element });
  }, []);

  const sendBounds = useCallback(
    (bounds: BbDesktopBrowserViewBounds) => {
      if (desktopBrowser === null) {
        return;
      }
      lastSentBoundsRef.current = bounds;
      desktopBrowser.setBounds({ tabId, bounds });
    },
    [desktopBrowser, tabId],
  );

  // Measure and push the current placement synchronously — measurements happen
  // inside ResizeObserver callbacks (post-layout) or force layout themselves,
  // so the rect is always fresh for the frame about to paint.
  const syncPlacement = useCallback(
    ({ force }: SyncBrowserViewPlacementArgs) => {
      const bounds = readBounds();
      if (bounds === null) {
        return;
      }
      const lastSentBounds = lastSentBoundsRef.current;
      if (
        !force &&
        lastSentBounds !== null &&
        browserViewBoundsEqual({ a: lastSentBounds, b: bounds })
      ) {
        return;
      }
      sendBounds(bounds);
    },
    [readBounds, sendBounds],
  );

  // Unconditional push for the coordinator's show() path, so bounds always
  // land before the view is made visible (never a stale/zero-bounds flash on
  // activation).
  const syncBounds = useCallback(() => {
    syncPlacement({ force: true });
  }, [syncPlacement]);

  const syncBoundsIfChanged = useCallback(() => {
    syncPlacement({ force: false });
  }, [syncPlacement]);

  // Initial bounds for attach. When the content element is not measurable yet
  // the dedupe key stays null, so the first layout observation always sends a
  // real placement.
  const syncInitialBounds = useCallback(() => {
    const bounds = readBounds();
    lastSentBoundsRef.current = bounds;
    return bounds ?? EMPTY_BROWSER_VIEW_BOUNDS;
  }, [readBounds]);

  // Create (or re-attach to) the native view on mount and stream navigation
  // state back. Unmount is not ownership teardown: switching threads unmounts
  // the deck, but the native view is intentionally retained so returning to the
  // thread can show the existing page without recreating/reloading it.
  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    const initialBounds = syncInitialBounds();
    const mountUrl = initialUrlRef.current;
    registerBrowserView({ environmentId, tabId, threadId });
    desktopBrowser.attach({
      tabId,
      url: mountUrl,
      bounds: initialBounds,
      // Only the active tab's view starts visible; background tabs attach hidden
      // (their page still loads) until activated.
      visible: isActiveRef.current && mountUrl.length > 0,
    });

    const unsubscribe = desktopBrowser.onState((nextState) => {
      if (nextState.tabId !== tabId) {
        return;
      }
      setState(nextState);
      setCurrentUrl(nextState.url);
      onUpdateRef.current({
        tabId,
        url: nextState.url,
        title: nextState.title,
      });
      if (!nextState.isLoading && nextState.url.length > 0) {
        recordVisitRef.current({
          url: nextState.url,
          title: nextState.title,
        });
      }
    });

    // Optional for version skew: an older shell's preload has no snapshot
    // channel, and the panel falls back to its bare background during resizes.
    const unsubscribeSnapshot = desktopBrowser.onSnapshot?.((snapshot) => {
      if (snapshot.tabId !== tabId) {
        return;
      }
      setResizeSnapshotUrl(snapshot.dataUrl);
    });

    return () => {
      unsubscribe();
      unsubscribeSnapshot?.();
      // The native view survives this unmount. Only explicit tab close/thread
      // deletion owns detach; unmount just disconnects this component's state
      // listener and forgets any stale visibility ownership.
      visibilityCoordinator?.release(tabId);
    };
  }, [
    desktopBrowser,
    environmentId,
    syncInitialBounds,
    visibilityCoordinator,
    tabId,
    threadId,
  ]);

  // Track panel-shape changes. The callback runs post-layout in the frame that
  // will paint the new shape, so measuring and pushing here keeps the native
  // view in lockstep with the chrome as it is actually painted — including
  // during native window drags, where the renderer's relayout (not the OS
  // window size) is what the surrounding chrome reflects.
  useEffect(() => {
    const element = contentRef.current;
    if (element === null || desktopBrowser === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      syncBoundsIfChanged();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  // ResizeObserver only reports size changes, but the content rect can move
  // without resizing: dragging the left sidebar shifts it (AppLayout emits the
  // sync event from the same rAF that applies the live sidebar width), and a
  // native window resize can translate a fixed-size panel. The window resize
  // listener re-measures on the renderer's own layout cadence; the bounds
  // dedupe in syncPlacement drops the no-op ticks.
  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }

    window.addEventListener(
      BROWSER_VIEW_BOUNDS_SYNC_EVENT,
      syncBoundsIfChanged,
    );
    window.addEventListener("resize", syncBoundsIfChanged);

    return () => {
      window.removeEventListener(
        BROWSER_VIEW_BOUNDS_SYNC_EVENT,
        syncBoundsIfChanged,
      );
      window.removeEventListener("resize", syncBoundsIfChanged);
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  // The native view is shown whenever this tab is the active panel tab and has a
  // page. It is NOT hidden during a drag-resize — the overlay tracks the live
  // bounds (see the ResizeObserver and layout-sync effects) so it follows
  // the panel smoothly instead of blanking and flashing. It stays attached when
  // hidden, so deactivation never reloads it. (Collapse/expand of the panel
  // toggles `isActive`, which hides the view outright rather than chasing a
  // CSS transition the overlay cannot clip to.)
  const isViewVisible = isActive && hasPage && !isBrowserDimmingModalOpen;
  // A layout effect (pre-paint) declares visibility so showing/hiding lands in
  // the same frame as the DOM tab swap — no flash. Ordering across tabs (hide
  // the previously-visible view BEFORE showing this one) and bounds-before-show
  // are owned by the deck's coordinator, so two native overlays never overlap
  // regardless of the order children's effects run in.
  useLayoutEffect(() => {
    if (visibilityCoordinator === null) {
      return;
    }
    if (isViewVisible) {
      visibilityCoordinator.show(tabId, syncBounds);
      return () => {
        visibilityCoordinator.hide(tabId);
      };
    }
    visibilityCoordinator.hide(tabId);
  }, [visibilityCoordinator, tabId, isViewVisible, syncBounds]);

  const navigateToInput = useCallback(
    (rawInput: string) => {
      const url = resolveBrowserAddressInput(rawInput);
      if (url === null) {
        return;
      }
      setCurrentUrl(url);
      setIsEditing(false);
      desktopBrowser?.navigate({ tabId, url });
    },
    [desktopBrowser, tabId],
  );

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToInput(addressDraft);
    },
    [addressDraft, navigateToInput],
  );

  const handleAddressFocus = useCallback(() => {
    setAddressDraft(currentUrl);
    setIsEditing(true);
  }, [currentUrl]);

  const handleReloadOrStop = useCallback(() => {
    if (state?.isLoading ?? false) {
      desktopBrowser?.stop(tabId);
      return;
    }
    desktopBrowser?.reload(tabId);
  }, [desktopBrowser, state?.isLoading, tabId]);

  if (desktopBrowser === null) {
    return <BrowserUnavailable />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserChrome
        addressDraft={addressDraft}
        isEditing={isEditing}
        state={state}
        currentUrl={currentUrl}
        onAddressChange={setAddressDraft}
        onAddressFocus={handleAddressFocus}
        onAddressBlur={() => setIsEditing(false)}
        onSubmit={handleAddressSubmit}
        onBack={() => desktopBrowser.goBack(tabId)}
        onForward={() => desktopBrowser.goForward(tabId)}
        onReloadOrStop={handleReloadOrStop}
        onOpenExternal={() => getBbDesktopInfo()?.openExternalUrl(currentUrl)}
      />
      {state?.errorText != null && hasPage ? (
        <div
          className={cn(
            "border-b border-border bg-destructive/10 px-3 py-2 text-destructive",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          {state.errorText}
        </div>
      ) : null}
      <div ref={contentRef} className="relative min-h-0 flex-1">
        {hasPage && !isBrowserDimmingModalOpen ? null : (
          <BrowserNewTabScreen
            onNavigateInput={navigateToInput}
            recent={recent}
            onClearRecent={clearRecent}
          />
        )}
        {hasPage && resizeSnapshotUrl !== null ? (
          // Stand-in for the hidden native view during a window resize. It
          // stretches with the panel — part of the chrome's surface, so it
          // stays glued to the panel however far the chrome paint lags the
          // drag. The live view overlays it again before it is cleared.
          <img
            src={resizeSnapshotUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full"
          />
        ) : null}
      </div>
    </div>
  );
}
