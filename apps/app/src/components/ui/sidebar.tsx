/* shadcn/ui-derived */
import * as React from "react";
import { flushSync } from "react-dom";
import { Slot } from "@radix-ui/react-slot";

import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { setCompactSidebarDrawerShowing } from "./sidebar-mobile-drawer-visibility.js";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "min(90vw, 320px)";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_MOBILE_SWIPE_BROWSER_EDGE_GUARD_PX = 24;
// Touches that start inside this band from the left edge get the scroll-
// blocking (non-passive) touch path so a horizontal swipe can claim the
// gesture from the browser; touches deeper in the content still open the
// drawer, but through a passive listener that never delays a scroll start.
const SIDEBAR_MOBILE_SWIPE_OPEN_EDGE_ZONE_PX = 72;
const SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX = 12;
const SIDEBAR_MOBILE_SWIPE_OPEN_RATIO = 0.33;
const SIDEBAR_MOBILE_SWIPE_OPEN_FLING_MIN_RATIO = 0.12;
const SIDEBAR_MOBILE_SWIPE_OPEN_FLING_VELOCITY_PX_PER_SEC = 450;
const SIDEBAR_MOBILE_DRAG_SETTLE_MS = 220;
// Upper bound on how long the closed compact drawer stays empty after boot
// before its subtree is realized regardless of main-thread idleness.
const SIDEBAR_MOBILE_REALIZE_TIMEOUT_MS = 1000;
const SIDEBAR_MOBILE_DRAG_SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
// The panel moves on the `translate` property, matching Tailwind v4's
// `-translate-x-full` utilities. Inline motion styles MUST use the same
// property: an inline `transform` does not interpolate against the class
// `translate`, so a slide written as `transform` silently snaps.
const SIDEBAR_MOBILE_PANEL_SETTLE_TRANSITION = `translate ${SIDEBAR_MOBILE_DRAG_SETTLE_MS}ms ${SIDEBAR_MOBILE_DRAG_SETTLE_EASING}`;
const SIDEBAR_MOBILE_BACKDROP_SETTLE_TRANSITION = `opacity ${SIDEBAR_MOBILE_DRAG_SETTLE_MS}ms ${SIDEBAR_MOBILE_DRAG_SETTLE_EASING}`;
const SIDEBAR_MOBILE_WHEEL_SWIPE_OPEN_DISTANCE_PX = 90;
const SIDEBAR_MOBILE_WHEEL_SWIPE_RESET_MS = 250;
// Fraction of the panel width a drag must cover before release closes the
// drawer (mirrors the old vaul closeThreshold).
const SIDEBAR_MOBILE_DRAG_CLOSE_RATIO = 0.25;
const SIDEBAR_MOBILE_DRAG_CLOSE_FLING_VELOCITY_PX_PER_SEC = 450;
// The transitions below must match SIDEBAR_MOBILE_DRAG_SETTLE_MS /
// SIDEBAR_MOBILE_DRAG_SETTLE_EASING; Tailwind arbitrary values cannot
// interpolate the constants. Keep the translated panel style-ready while it
// is closed. WebKit otherwise rebuilds its style and accessibility subtrees
// when `visibility` flips during every open.
const SIDEBAR_MOBILE_PANEL_TRANSITION_CLASS =
  "[transition:translate_220ms_cubic-bezier(0.32,0.72,0,1)]";
const SIDEBAR_MOBILE_BACKDROP_TRANSITION_CLASS =
  "[transition:opacity_220ms_cubic-bezier(0.32,0.72,0,1)]";
const SIDEBAR_GROUP_LABEL_BASE_CLASS =
  "duration-200 flex shrink-0 items-center rounded-md px-1 text-xs font-medium text-sidebar-foreground/75 outline-none ring-sidebar-ring transition-[margin,opa] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0";
const SIDEBAR_GROUP_LABEL_COLLAPSED_CLASS =
  "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0";

type SidebarMobileWidthStyle = React.CSSProperties & {
  "--sidebar-width-mobile": string;
};

type SidebarInsetSwipeSession = {
  kind: "pointer" | "touch";
  id: number;
  startX: number;
  startY: number;
  panelWidth: number;
  lastProgress: number;
  lastClientX: number;
  lastTimeMs: number;
  velocityX: number;
  isDragging: boolean;
  selectionRoot: Element | null;
  startTarget: Element | null;
  /**
   * Whether the move listener for this session was registered non-passive,
   * so `preventDefault` can stop the browser from scrolling once the swipe
   * has horizontal intent. Passive sessions must not call it (the browser
   * ignores it and Chrome logs an intervention warning).
   */
  canPreventDefault: boolean;
};

const sidebarMobileWidthStyle: SidebarMobileWidthStyle = {
  "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
};

function getSidebarMobilePanelWidth(): number {
  if (typeof window === "undefined") {
    return 320;
  }

  return Math.min(window.innerWidth * 0.9, 320);
}

function clampSidebarMobileSwipeProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function getSidebarMobileMotionNodes(): {
  panel: HTMLElement | null;
  backdrop: HTMLElement | null;
} {
  if (typeof document === "undefined") {
    return { panel: null, backdrop: null };
  }

  const panel = document.querySelector(
    '[data-sidebar="panel"][data-vaul-drawer-direction]',
  );
  const backdrop = document.querySelector("[data-sidebar-mobile-backdrop]");

  return {
    panel: panel instanceof HTMLElement ? panel : null,
    backdrop: backdrop instanceof HTMLElement ? backdrop : null,
  };
}

function getSidebarMobilePanelTranslate(progress: number): string {
  const hiddenPercent = (1 - progress) * 100;
  return `-${hiddenPercent}%`;
}

function applySidebarMobileDragStyles({
  progress,
  settling,
}: {
  progress: number;
  settling: boolean;
}) {
  const { panel, backdrop } = getSidebarMobileMotionNodes();

  if (panel !== null) {
    panel.setAttribute("data-vaul-animate", "false");
    panel.style.translate = getSidebarMobilePanelTranslate(progress);
    panel.style.transition = settling
      ? SIDEBAR_MOBILE_PANEL_SETTLE_TRANSITION
      : "none";
  }

  if (backdrop !== null) {
    backdrop.setAttribute("data-vaul-animate", "false");
    backdrop.style.opacity = String(progress);
    backdrop.style.transition = settling
      ? SIDEBAR_MOBILE_BACKDROP_SETTLE_TRANSITION
      : "none";
    // The deferred open keeps data-state="closed" (pointer-events-none)
    // until the settle commit, while the panel is still `inert` — without
    // this inline override a rapid second tap during the slide-in falls
    // through both layers onto the page below.
    backdrop.style.pointerEvents = progress > 0 ? "auto" : "";
  }
}

function clearSidebarMobileDragAttributes() {
  const { panel, backdrop } = getSidebarMobileMotionNodes();
  panel?.removeAttribute("data-vaul-animate");
  backdrop?.removeAttribute("data-vaul-animate");
}

function clearSidebarMobileDragStyles() {
  const { panel, backdrop } = getSidebarMobileMotionNodes();

  if (panel !== null) {
    panel.removeAttribute("data-vaul-animate");
    panel.style.translate = "";
    panel.style.transition = "";
  }

  if (backdrop !== null) {
    backdrop.removeAttribute("data-vaul-animate");
    backdrop.style.opacity = "";
    backdrop.style.transition = "";
    backdrop.style.pointerEvents = "";
  }
}

function createSidebarInsetSwipeSession({
  kind,
  id,
  startX,
  startY,
  selectionRoot,
  startTarget,
  canPreventDefault,
}: {
  kind: "pointer" | "touch";
  id: number;
  startX: number;
  startY: number;
  selectionRoot: Element | null;
  startTarget: Element | null;
  canPreventDefault: boolean;
}): SidebarInsetSwipeSession {
  const nowMs = Date.now();
  return {
    kind,
    id,
    startX,
    startY,
    panelWidth: getSidebarMobilePanelWidth(),
    lastProgress: 0,
    lastClientX: startX,
    lastTimeMs: nowMs,
    velocityX: 0,
    isDragging: false,
    selectionRoot,
    startTarget,
    canPreventDefault,
  };
}

/**
 * Whether a content-area touch swipe may register the scroll-blocking touch
 * path. Only touches near the left edge (past the browser's own back-swipe
 * guard) get it; see SIDEBAR_MOBILE_SWIPE_OPEN_EDGE_ZONE_PX.
 */
function isSidebarSwipeEdgeZoneTouch(clientX: number): boolean {
  return (
    clientX >= SIDEBAR_MOBILE_SWIPE_BROWSER_EDGE_GUARD_PX &&
    clientX < SIDEBAR_MOBILE_SWIPE_OPEN_EDGE_ZONE_PX
  );
}

function shouldOpenSidebarMobileSwipe(
  session: SidebarInsetSwipeSession,
): boolean {
  return (
    session.lastProgress >= SIDEBAR_MOBILE_SWIPE_OPEN_RATIO ||
    (session.lastProgress >= SIDEBAR_MOBILE_SWIPE_OPEN_FLING_MIN_RATIO &&
      session.velocityX >= SIDEBAR_MOBILE_SWIPE_OPEN_FLING_VELOCITY_PX_PER_SEC)
  );
}

function isHorizontallyScrollableElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) {
    return false;
  }

  const overflowX = view.getComputedStyle(element).overflowX;
  if (
    overflowX !== "auto" &&
    overflowX !== "scroll" &&
    overflowX !== "overlay"
  ) {
    return false;
  }

  return element.scrollWidth > element.clientWidth + 1;
}

/**
 * Each ancestor probe pairs `getComputedStyle` with a `scrollWidth` read, so a
 * call forces a synchronous style + layout pass of the document. Never call
 * this from a per-tap listener (`pointerdown`/`touchstart`): on a large
 * timeline that flush can block a mobile main thread for seconds (#1269).
 * Callers must defer it until a gesture shows real horizontal intent.
 */
function isInsideHorizontalScrollRegion(target: Element): boolean {
  let element: Element | null = target;
  while (element !== null) {
    if (isHorizontallyScrollableElement(element)) {
      return true;
    }
    if (
      element.matches('[data-sidebar="inset"], [data-sidebar-mobile-backdrop]')
    ) {
      return false;
    }
    element = element.parentElement;
  }

  return false;
}

function getSidebarSwipeSelectionRoot(
  target: EventTarget | null,
): Element | null {
  return target instanceof Element
    ? target.closest("[data-sidebar-swipe-selectable]")
    : null;
}

function hasExpandedTextSelectionWithin(root: Element): boolean {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed) {
    return false;
  }

  return (
    (selection.anchorNode !== null && root.contains(selection.anchorNode)) ||
    (selection.focusNode !== null && root.contains(selection.focusNode))
  );
}

function shouldIgnoreSidebarSwipeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (
    target.closest(
      [
        "input",
        "textarea",
        "select",
        '[contenteditable="true"]',
        '[role="slider"]',
        '[data-sidebar="panel"]',
        '[data-sidebar="trigger"]',
        "[data-vaul-drawer]",
        "[data-vaul-no-drag]",
        "[data-no-sidebar-swipe]",
      ].join(", "),
    ) !== null
  ) {
    return true;
  }

  const selectionRoot = getSidebarSwipeSelectionRoot(target);
  return (
    selectionRoot !== null && hasExpandedTextSelectionWithin(selectionRoot)
  );
}

function isSidebarInsetSwipeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const ownerDocument = target.ownerDocument;
  const isDocumentRootTarget =
    target === ownerDocument.body || target === ownerDocument.documentElement;
  if (
    isDocumentRootTarget &&
    // Radix keeps modal content mounted while closing. During that short window
    // outside pointer blocking can make fast follow-up touches target html/body.
    ownerDocument.querySelector(
      '[data-sidebar="panel"][data-state="closed"]',
    ) !== null
  ) {
    return true;
  }

  return (
    target.closest(
      '[data-sidebar="inset"], [data-sidebar-mobile-backdrop][data-state="closed"]',
    ) !== null
  );
}

function getTouchByIdentifier(
  touches: TouchList,
  identifier: number,
): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function getTrackedSwipeTouch(
  event: TouchEvent,
  identifier: number,
): Touch | null {
  return (
    getTouchByIdentifier(event.touches, identifier) ??
    getTouchByIdentifier(event.changedTouches, identifier)
  );
}

/**
 * Schedules the one-time realization of the closed compact drawer's subtree
 * off the boot critical path. It prefers an idle callback so the sidebar
 * rows, DnD contexts and search hooks mount after the route chunk has been
 * fetched and evaluated; browsers without `requestIdleCallback` get two
 * animation frames instead. The timeout bounds the wait (an idle callback
 * can starve during a long boot, and frames stop in background tabs) so a
 * later open never finds an unrealized panel. Returns a cancel function.
 */
function scheduleSidebarMobileRealization(realize: () => void): () => void {
  let settled = false;
  let idleHandle: number | null = null;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;
  const cancel = () => {
    if (idleHandle !== null) {
      window.cancelIdleCallback(idleHandle);
      idleHandle = null;
    }
    if (firstFrame !== null) {
      window.cancelAnimationFrame(firstFrame);
      firstFrame = null;
    }
    if (secondFrame !== null) {
      window.cancelAnimationFrame(secondFrame);
      secondFrame = null;
    }
    window.clearTimeout(timeout);
  };
  const run = () => {
    if (settled) {
      return;
    }
    settled = true;
    cancel();
    realize();
  };
  const timeout = window.setTimeout(run, SIDEBAR_MOBILE_REALIZE_TIMEOUT_MS);
  if (typeof window.requestIdleCallback === "function") {
    idleHandle = window.requestIdleCallback(
      () => {
        idleHandle = null;
        run();
      },
      { timeout: SIDEBAR_MOBILE_REALIZE_TIMEOUT_MS },
    );
  } else {
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null;
        run();
      });
    });
  }
  return () => {
    settled = true;
    cancel();
  };
}

type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  isMobileSidebarClosing: boolean;
  /**
   * Whether the compact drawer's subtree is mounted. It starts false so the
   * closed, inert panel adds no render work to boot; the first open (or an
   * idle window, at most one second after boot) latches it true for the
   * rest of the session. Always false outside compact viewports.
   */
  isMobileSidebarRealized: boolean;
  suppressMobileOpenAnimation: boolean;
  setSuppressMobileOpenAnimation: (suppress: boolean) => void;
  suppressMobileCloseAnimation: boolean;
  setSuppressMobileCloseAnimation: (suppress: boolean) => void;
  isCompactViewport: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

/**
 * The desktop sidebar width, as a CSS length. Its own context (not a field of
 * {@link SidebarContext}) because a resize drag updates it on every animation
 * frame, and only {@link Sidebar} needs to re-render for that. `Sidebar` writes
 * it as `--sidebar-width` directly on the two elements that consume it, never
 * on an ancestor: `--sidebar-width` is registered as non-inherited in
 * theme.css, so a per-frame change restyles those two elements instead of the
 * whole app subtree.
 */
const SidebarWidthContext = React.createContext<string>(SIDEBAR_WIDTH);

/**
 * "Is the sidebar visible" as its own boolean context. The full
 * {@link SidebarContext} value changes on every provider commit (the mobile
 * close flips the closing flag, then four states), and its readers include
 * the page header and the retained secondary panel, whose ~1000-line bodies
 * only need this one bit. A boolean context re-renders them only when the
 * bit flips. `null` outside a provider.
 */
const SidebarShowingContext = React.createContext<boolean | null>(null);

const SidebarContentElementContext =
  React.createContext<React.RefObject<HTMLDivElement | null> | null>(null);

/**
 * Ref object holding the sidebar's scrolling content element
 * (`SidebarContent`). The windowed thread list reads `.current` inside
 * effects to decide which rows sit near the scrollport. The ref object is
 * stable, so consuming it never re-renders; returns null outside a
 * `SidebarContent`.
 */
function useSidebarContentElementRef() {
  return React.useContext(SidebarContentElementContext);
}

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function useIsSidebarShowing(): boolean {
  const isShowing = React.useContext(SidebarShowingContext);
  if (isShowing === null) {
    throw new Error(
      "useIsSidebarShowing must be used within a SidebarProvider.",
    );
  }
  return isShowing;
}

function useOptionalIsSidebarShowing(): boolean | null {
  return React.useContext(SidebarShowingContext);
}

/**
 * Stable callback that closes the mobile sidebar drawer. Every navigation
 * triggered from inside the sidebar must call this so the destination view is
 * revealed on compact viewports; on wider viewports the drawer state is
 * already closed and the call is a no-op. The close starts the slide-out
 * transition immediately and defers the React state flip until the panel is
 * offscreen, so the exit animation survives the commit's style recalculation.
 */
function useCloseMobileSidebar() {
  const { closeMobileSidebar } = useSidebar();
  return closeMobileSidebar;
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Desktop sidebar width as a CSS length. Defaults to 16rem. */
    width?: string;
  }
>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
      width = SIDEBAR_WIDTH,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const isCompactViewport = useIsCompactViewport();
    const [openMobile, setOpenMobile] = React.useState(false);
    const [suppressMobileOpenAnimation, setSuppressMobileOpenAnimation] =
      React.useState(false);
    const [suppressMobileCloseAnimation, setSuppressMobileCloseAnimation] =
      React.useState(false);
    const [isMobileSidebarClosing, setIsMobileSidebarClosing] =
      React.useState(false);
    const [hasRealizedMobileSidebar, setHasRealizedMobileSidebar] =
      React.useState(false);
    const realizeMobileSidebar = React.useCallback(() => {
      setHasRealizedMobileSidebar(true);
    }, []);
    const mobileSettleTimeoutRef = React.useRef<number | null>(null);

    const clearMobileSettleTimeout = React.useCallback(() => {
      if (mobileSettleTimeoutRef.current !== null) {
        window.clearTimeout(mobileSettleTimeoutRef.current);
        mobileSettleTimeoutRef.current = null;
      }
    }, []);

    const openMobileRef = React.useRef(openMobile);
    React.useEffect(() => {
      openMobileRef.current = openMobile;
    }, [openMobile]);

    // Publish drawer visibility for non-React readers (see
    // sidebar-mobile-drawer-visibility.ts) without widening the context.
    React.useEffect(() => {
      setCompactSidebarDrawerShowing(isCompactViewport && openMobile);
      return () => {
        setCompactSidebarDrawerShowing(false);
      };
    }, [isCompactViewport, openMobile]);

    // Stable identity: sidebar rows close the drawer on navigation, and an
    // unstable callback would re-render every memoized row on each toggle.
    // Reads the open state through a ref instead of closing over it.
    const closeMobileSidebar = React.useCallback(() => {
      if (!openMobileRef.current || mobileSettleTimeoutRef.current !== null) {
        return;
      }

      // Start the compositor transition while React state stays open. The
      // close commit (panel `inert`, data-state flips) then pays its style
      // recalculation after the panel has moved offscreen instead of
      // consuming the whole transition window.
      setIsMobileSidebarClosing(true);
      applySidebarMobileDragStyles({ progress: 0, settling: true });
      mobileSettleTimeoutRef.current = window.setTimeout(() => {
        mobileSettleTimeoutRef.current = null;
        flushSync(() => {
          setSuppressMobileOpenAnimation(false);
          setSuppressMobileCloseAnimation(true);
          setIsMobileSidebarClosing(false);
          setOpenMobile(false);
        });
        clearSidebarMobileDragAttributes();
      }, SIDEBAR_MOBILE_DRAG_SETTLE_MS);
    }, []);

    // The symmetric deferred open. The persistent panel already holds its
    // full content, so the compositor can slide it in before React knows the
    // drawer is open. The open commit (panel `inert` removal, data-state
    // flips) then pays its style recalculation — ~280 ms on iOS Safari for a
    // large sidebar — after the slide instead of blocking its first frame.
    // The panel stays `inert` until the commit lands one settle window
    // later; the drag helper puts inline pointer-events on the backdrop so
    // taps during the slide land on the backdrop, not the page below.
    const openMobileSidebar = React.useCallback(() => {
      if (openMobileRef.current || mobileSettleTimeoutRef.current !== null) {
        return;
      }

      // Mount the subtree now if boot has not realized it yet, so it commits
      // during the slide instead of after the settle.
      realizeMobileSidebar();
      applySidebarMobileDragStyles({ progress: 1, settling: true });
      mobileSettleTimeoutRef.current = window.setTimeout(() => {
        mobileSettleTimeoutRef.current = null;
        flushSync(() => {
          // The panel already sits at the open transform; suppressing the
          // open animation keeps the commit from replaying the slide.
          setSuppressMobileOpenAnimation(true);
          setSuppressMobileCloseAnimation(false);
          setOpenMobile(true);
        });
        clearSidebarMobileDragAttributes();
      }, SIDEBAR_MOBILE_DRAG_SETTLE_MS);
    }, [realizeMobileSidebar]);

    React.useEffect(
      () => () => {
        clearMobileSettleTimeout();
      },
      [clearMobileSettleTimeout],
    );

    // The latch. An open that bypasses `openMobileSidebar` (the swipe path
    // and direct `setOpenMobile(true)` callers) realizes the subtree in the
    // same render (React restarts this render before committing), and a
    // drawer that stays closed realizes off the boot critical path. Desktop
    // never schedules; its sidebar renders children directly.
    if (isCompactViewport && openMobile && !hasRealizedMobileSidebar) {
      setHasRealizedMobileSidebar(true);
    }
    const isMobileSidebarRealized =
      isCompactViewport && hasRealizedMobileSidebar;
    React.useEffect(() => {
      if (!isCompactViewport || hasRealizedMobileSidebar) {
        return;
      }
      return scheduleSidebarMobileRealization(realizeMobileSidebar);
    }, [hasRealizedMobileSidebar, isCompactViewport, realizeMobileSidebar]);

    React.useEffect(() => {
      if (openMobile) {
        setSuppressMobileCloseAnimation(false);
      } else {
        setSuppressMobileOpenAnimation(false);
      }
    }, [openMobile]);

    const [_open, _setOpen] = React.useState(defaultOpen);
    const open = openProp ?? _open;
    const setOpen = React.useCallback(
      (value: boolean | ((value: boolean) => boolean)) => {
        const openState = typeof value === "function" ? value(open) : value;
        if (setOpenProp) {
          setOpenProp(openState);
        } else {
          _setOpen(openState);
        }
      },
      [setOpenProp, open],
    );

    // Helper to toggle the sidebar.
    const toggleSidebar = React.useCallback(() => {
      if (!isCompactViewport) {
        setOpen((open) => !open);
        return;
      }
      if (openMobile) {
        closeMobileSidebar();
        return;
      }
      openMobileSidebar();
    }, [
      closeMobileSidebar,
      isCompactViewport,
      openMobile,
      openMobileSidebar,
      setOpen,
    ]);

    // We add a state so that we can do data-state="expanded" or "collapsed".
    // This makes it easier to style the sidebar with Tailwind classes.
    const state = open ? "expanded" : "collapsed";

    const contextValue = React.useMemo<SidebarContext>(
      () => ({
        state,
        open,
        setOpen,
        isCompactViewport,
        openMobile,
        setOpenMobile,
        openMobileSidebar,
        closeMobileSidebar,
        isMobileSidebarClosing,
        isMobileSidebarRealized,
        suppressMobileOpenAnimation,
        setSuppressMobileOpenAnimation,
        suppressMobileCloseAnimation,
        setSuppressMobileCloseAnimation,
        toggleSidebar,
      }),
      [
        state,
        open,
        setOpen,
        isCompactViewport,
        openMobile,
        setOpenMobile,
        openMobileSidebar,
        closeMobileSidebar,
        isMobileSidebarClosing,
        isMobileSidebarRealized,
        suppressMobileOpenAnimation,
        setSuppressMobileOpenAnimation,
        suppressMobileCloseAnimation,
        setSuppressMobileCloseAnimation,
        toggleSidebar,
      ],
    );

    const isSidebarShowing = isCompactViewport ? openMobile : open;

    return (
      <SidebarContext.Provider value={contextValue}>
        <SidebarShowingContext.Provider value={isSidebarShowing}>
          <SidebarWidthContext.Provider value={width}>
            {/* Match the agent message action bar's tooltip timing (300ms open
            delay + Radix's default skip window) so sidebar icon tooltips feel
            the same instead of flashing instantly on hover. disableHoverableContent
            dismisses the tooltip the moment the pointer leaves the trigger, so it
            never lingers/floats while the mouse moves on. */}
            <TooltipProvider delayDuration={300} disableHoverableContent>
              <div
                style={
                  {
                    "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                    ...style,
                  } as React.CSSProperties
                }
                className={cn(
                  // Fill the app root instead of re-measuring the viewport here.
                  // app.css owns the browser-mode-specific root height, while fixed
                  // sidebar panels read the shared --bb-shell-height override.
                  "group/sidebar-wrapper flex h-full min-h-0 w-full has-[[data-variant=inset]]:bg-sidebar",
                  className,
                )}
                ref={ref}
                {...props}
              >
                {children}
              </div>
            </TooltipProvider>
          </SidebarWidthContext.Provider>
        </SidebarShowingContext.Provider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, style, children, ...props }, ref) => {
    const {
      isCompactViewport,
      state,
      openMobile,
      setOpenMobile,
      closeMobileSidebar,
      isMobileSidebarRealized,
      suppressMobileOpenAnimation,
      setSuppressMobileOpenAnimation,
      suppressMobileCloseAnimation,
      setSuppressMobileCloseAnimation,
    } = useSidebar();
    const width = React.useContext(SidebarWidthContext);
    // Written on the consuming elements themselves (see SidebarWidthContext).
    const widthStyle = { "--sidebar-width": width } as React.CSSProperties;
    const handleOpenMobileChange = React.useCallback(
      (nextOpen: boolean) => {
        if (nextOpen) {
          setSuppressMobileCloseAnimation(false);
        } else {
          setSuppressMobileOpenAnimation(false);
        }
        setOpenMobile(nextOpen);
      },
      [
        setOpenMobile,
        setSuppressMobileCloseAnimation,
        setSuppressMobileOpenAnimation,
      ],
    );
    const shouldSuppressMobileCloseAnimation =
      !openMobile && suppressMobileCloseAnimation;
    const mobilePanelMotionStyle = React.useMemo<
      React.CSSProperties | undefined
    >(() => {
      if (shouldSuppressMobileCloseAnimation) {
        return {
          translate: "-100%",
          transition: "none",
        };
      }

      return undefined;
    }, [shouldSuppressMobileCloseAnimation]);
    const mobileBackdropStyle = React.useMemo<
      React.CSSProperties | undefined
    >(() => {
      if (shouldSuppressMobileCloseAnimation) {
        return {
          opacity: 0,
          pointerEvents: "none",
          transition: "none",
        };
      }

      return undefined;
    }, [shouldSuppressMobileCloseAnimation]);

    if (isCompactViewport) {
      // The mobile drawer stays mounted across open/close (#1261). Closing
      // translates the panel off-screen instead of unmounting it, so a
      // reopen replays no mount work. While closed the translated panel is
      // `inert`, so it cannot trap focus or taps. It stays style-ready because
      // a visibility flip makes WebKit rebuild the subtree during every open.
      // The subtree itself is realized once, off the boot critical path or on
      // the first open, and then retained (the provider owns the latch).
      return (
        <SidebarMobilePanel
          ref={ref}
          open={openMobile}
          onOpenChange={handleOpenMobileChange}
          onDismiss={closeMobileSidebar}
          suppressOpenAnimation={suppressMobileOpenAnimation}
          panelMotionStyle={mobilePanelMotionStyle}
          backdropStyle={mobileBackdropStyle}
          className={className}
          style={style}
          {...props}
        >
          {isMobileSidebarRealized ? children : null}
        </SidebarMobilePanel>
      );
    }

    return (
      <div
        ref={ref}
        className="group peer text-sidebar-foreground"
        data-state={state}
        data-collapsible={state === "collapsed" ? "offcanvas" : ""}
        data-variant="sidebar"
        data-side="left"
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          data-sidebar="gap"
          style={widthStyle}
          className={cn(
            "relative hidden h-full w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear md:block",
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          )}
        />
        <div
          data-sidebar="panel"
          className={cn(
            // Fixed: a percentage height would resolve against the short
            // initial containing block, so it reads the shell unit directly.
            // The visibility leg hides the fully collapsed offcanvas panel
            // after the slide-out so its mounted rows stop painting (#1261);
            // the zero delay on expand shows it again immediately.
            "fixed inset-y-0 z-10 flex h-(--bb-shell-height) w-(--sidebar-width) select-none flex-col bg-sidebar text-sidebar-foreground [transition:left_200ms_linear,right_200ms_linear,width_200ms_linear,visibility_0s_linear_0s]",
            "group-data-[collapsible=offcanvas]:invisible group-data-[collapsible=offcanvas]:[transition:left_200ms_linear,right_200ms_linear,width_200ms_linear,visibility_0s_linear_200ms]",
            "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]",
            "group-data-[collapsible=icon]:w-(--sidebar-width-icon) border-border-seam group-data-[side=left]:border-r group-data-[side=right]:border-l",
            className,
          )}
          style={{ ...widthStyle, ...style }}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Sidebar.displayName = "Sidebar";

type SidebarPanelDragSession = {
  kind: "pointer" | "touch";
  id: number;
  startX: number;
  startY: number;
  panelWidth: number;
  lastProgress: number;
  lastClientX: number;
  lastTimeMs: number;
  velocityX: number;
  isDragging: boolean;
  startTarget: Element | null;
};

function suppressNextSidebarPanelDragClick() {
  const cleanup = () => {
    window.removeEventListener("click", suppressClick, { capture: true });
    window.clearTimeout(timeout);
  };
  const suppressClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  };
  const timeout = window.setTimeout(cleanup, 400);
  window.addEventListener("click", suppressClick, {
    capture: true,
    once: true,
  });
}

interface SidebarMobilePanelProps extends React.ComponentProps<"div"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Deferred close: starts the slide-out transition immediately and flips the
  // React state after the settle window. Backdrop taps and Escape use this;
  // the drag paths call `onOpenChange(false)` directly because their panel is
  // already at the closed transform when they settle.
  onDismiss: () => void;
  suppressOpenAnimation: boolean;
  panelMotionStyle?: React.CSSProperties;
  backdropStyle?: React.CSSProperties;
}

const SIDEBAR_MOBILE_TAB_STOP_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The open drawer's Tab cycle: the pinned sidebar trigger(s) outside the
 * panel, then every focusable inside the panel. The trigger stays in the
 * cycle because it remains interactive while the drawer is open (a second
 * press closes it).
 */
function getSidebarMobileTabStops(panel: HTMLElement): HTMLElement[] {
  const doc = panel.ownerDocument;
  const triggerStops = Array.from(
    doc.querySelectorAll('[data-sidebar="trigger"]'),
  ).filter((element) => !panel.contains(element));
  const panelStops = Array.from(
    panel.querySelectorAll(SIDEBAR_MOBILE_TAB_STOP_SELECTOR),
  );
  return [...triggerStops, ...panelStops].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      !element.matches(":disabled") &&
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.closest("[inert]") === null,
  );
}

/**
 * The persistent mobile sidebar drawer. Unlike the previous vaul drawer it
 * never unmounts its children: closing translates the panel off-screen, while
 * `inert` takes it out of hit-testing, focus order, and the accessibility
 * tree. Reopening therefore replays no mount cost or visibility-driven style
 * rebuild (#1261).
 *
 * The DOM contract the swipe-open code in SidebarInset relies on is kept:
 * `[data-sidebar="panel"][data-vaul-drawer-direction]` selects the panel,
 * `[data-sidebar-mobile-backdrop]` the backdrop, and inline styles written by
 * the shared drag helpers win over the class-driven state styles.
 */
const SidebarMobilePanel = React.forwardRef<
  HTMLDivElement,
  SidebarMobilePanelProps
>(
  (
    {
      open,
      onOpenChange,
      onDismiss,
      suppressOpenAnimation,
      panelMotionStyle,
      backdropStyle,
      className,
      style,
      children,
      onPointerDown,
      onTouchStart,
      ...props
    },
    ref,
  ) => {
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const backdropRef = React.useRef<HTMLDivElement | null>(null);
    const setPanelRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );
    const dragSessionRef = React.useRef<SidebarPanelDragSession | null>(null);
    const removeDragListenersRef = React.useRef<(() => void) | null>(null);
    const settleTimeoutRef = React.useRef<number | null>(null);

    const clearDragSession = React.useCallback(() => {
      removeDragListenersRef.current?.();
      removeDragListenersRef.current = null;
      dragSessionRef.current = null;
    }, []);

    const clearSettleTimeout = React.useCallback(() => {
      if (settleTimeoutRef.current !== null) {
        window.clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
    }, []);

    // The drag helpers write inline transform/opacity/transition onto the
    // persistent panel and backdrop. With vaul those nodes unmounted on
    // close, so stale styles could never survive; now they must be cleared
    // whenever the open state settles so class-driven styles take over.
    React.useLayoutEffect(() => {
      clearSidebarMobileDragStyles();
    }, [open]);

    React.useEffect(() => {
      if (!open) {
        return;
      }

      const previouslyFocused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // A touch-opened drawer does not need DOM focus. On iOS, focusing this
      // newly interactive subtree can synchronously rebuild style and the
      // accessibility tree for hundreds of milliseconds. Keyboard and
      // assistive-technology activation leave the trigger focus-visible, so
      // keep the modal focus move for those paths.
      const shouldMoveFocus =
        previouslyFocused?.matches('[data-sidebar="trigger"]:focus-visible') ??
        false;
      if (shouldMoveFocus) {
        panelRef.current?.focus({ preventScroll: true });
      }

      // The drawer is modal, but its siblings must NOT be marked `inert`:
      // toggling `inert` on the content inset forces WebKit (and Blink) to
      // re-resolve computed style for that entire subtree, which on a long
      // thread timeline costs hundreds of milliseconds per open/close. The
      // backdrop already blocks pointer input, `aria-modal` scopes assistive
      // technology, and this Tab trap owns keyboard focus, so no attribute
      // flip has to touch the large subtree. The pinned sidebar trigger
      // stays interactive on purpose: a second press closes the drawer.
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === "Escape") {
          onDismiss();
          return;
        }
        if (event.key !== "Tab") {
          return;
        }
        const panel = panelRef.current;
        const shell = panel?.parentElement ?? null;
        if (panel === null || shell === null) {
          return;
        }
        const doc = panel.ownerDocument;
        const active = doc.activeElement;
        // Portalled surfaces (row context menus under document.body) manage
        // their own focus; the trap only arbitrates Tab inside the app shell.
        if (active !== null && active !== doc.body && !shell.contains(active)) {
          return;
        }
        const stops = getSidebarMobileTabStops(panel);
        if (stops.length === 0) {
          return;
        }
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        const activeIndex =
          active instanceof HTMLElement ? stops.indexOf(active) : -1;
        // Focus can silently fail on a hidden stop; walk until one takes.
        for (let step = 1; step <= stops.length; step += 1) {
          const nextIndex =
            activeIndex === -1
              ? event.shiftKey
                ? stops.length - step
                : step - 1
              : (((activeIndex + direction * step) % stops.length) +
                  stops.length) %
                stops.length;
          const candidate = stops[nextIndex];
          candidate?.focus({ preventScroll: true });
          if (doc.activeElement === candidate) {
            return;
          }
        }
      };
      window.addEventListener("keydown", handleKeyDown);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          panelRef.current?.contains(active)
        ) {
          active.blur();
          if (shouldMoveFocus) {
            previouslyFocused?.focus({ preventScroll: true });
          }
        }
      };
    }, [open, onDismiss]);

    React.useEffect(
      () => () => {
        clearDragSession();
        clearSettleTimeout();
        clearSidebarMobileDragStyles();
      },
      [clearDragSession, clearSettleTimeout],
    );

    // Drag-to-close, replacing vaul's dismissible drag: a horizontal touch
    // drag toward the closed side follows the pointer; release settles by
    // distance or fling velocity. Like SidebarInset's swipe-open, it runs a
    // pointer path AND a native touch path: browsers cancel pointer events
    // once they claim a pan for scrolling, so the touch path (non-passive,
    // preventDefault once intent is horizontal) has to carry the gesture.
    const restoreOpenAfterCancelledDrag = () => {
      clearSettleTimeout();
      applySidebarMobileDragStyles({ progress: 1, settling: true });
      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null;
        clearSidebarMobileDragStyles();
      }, SIDEBAR_MOBILE_DRAG_SETTLE_MS);
    };

    const continuePanelDrag = (
      clientX: number,
      clientY: number,
      event: PointerEvent | TouchEvent,
    ) => {
      const session = dragSessionRef.current;
      if (session === null) {
        return;
      }

      const deltaX = clientX - session.startX;
      const deltaY = clientY - session.startY;
      const closeDelta = -deltaX;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (!session.isDragging) {
        if (
          absDeltaY > SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX &&
          absDeltaY > absDeltaX * 1.15
        ) {
          // Vertical intent: this is a list scroll, not a dismissal.
          clearDragSession();
          return;
        }
        if (
          closeDelta < SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX ||
          absDeltaX <= absDeltaY * 1.25
        ) {
          return;
        }
        if (
          session.startTarget !== null &&
          (!session.startTarget.isConnected ||
            isInsideHorizontalScrollRegion(session.startTarget))
        ) {
          clearDragSession();
          return;
        }
        session.isDragging = true;
        clearSettleTimeout();
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const nowMs = Date.now();
      const elapsedMs = nowMs - session.lastTimeMs;
      if (elapsedMs > 0) {
        session.velocityX =
          ((clientX - session.lastClientX) / elapsedMs) * 1000;
        session.lastClientX = clientX;
        session.lastTimeMs = nowMs;
      }
      const progress = clampSidebarMobileSwipeProgress(
        1 - closeDelta / session.panelWidth,
      );
      session.lastProgress = progress;
      applySidebarMobileDragStyles({ progress, settling: false });
    };

    const finishPanelDrag = (event: PointerEvent | TouchEvent) => {
      const session = dragSessionRef.current;
      if (session === null) {
        return;
      }

      clearDragSession();
      if (!session.isDragging) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      suppressNextSidebarPanelDragClick();

      const closeVelocity = -session.velocityX;
      const shouldClose =
        session.lastProgress <= 1 - SIDEBAR_MOBILE_DRAG_CLOSE_RATIO ||
        (session.lastProgress <=
          1 - SIDEBAR_MOBILE_SWIPE_OPEN_FLING_MIN_RATIO &&
          closeVelocity >= SIDEBAR_MOBILE_DRAG_CLOSE_FLING_VELOCITY_PX_PER_SEC);

      clearSettleTimeout();
      applySidebarMobileDragStyles({
        progress: shouldClose ? 0 : 1,
        settling: true,
      });
      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null;
        if (shouldClose) {
          // The panel already sits at the closed transform, so flipping the
          // state transitions from -100% to -100%: no visible snap.
          onOpenChange(false);
        } else {
          clearSidebarMobileDragStyles();
        }
      }, SIDEBAR_MOBILE_DRAG_SETTLE_MS);
    };

    const cancelPanelDrag = () => {
      const wasDragging = dragSessionRef.current?.isDragging ?? false;
      clearDragSession();
      if (wasDragging) {
        restoreOpenAfterCancelledDrag();
      }
    };

    const isIgnoredPanelDragTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="slider"], [data-vaul-no-drag], [data-no-sidebar-swipe]',
      ) !== null;

    const beginPanelDragSession = (
      kind: "pointer" | "touch",
      id: number,
      clientX: number,
      clientY: number,
      target: EventTarget | null,
    ) => {
      dragSessionRef.current = {
        kind,
        id,
        startX: clientX,
        startY: clientY,
        panelWidth: getSidebarMobilePanelWidth(),
        lastProgress: 1,
        lastClientX: clientX,
        lastTimeMs: Date.now(),
        velocityX: 0,
        isDragging: false,
        startTarget: target instanceof Element ? target : null,
      };
    };

    const handlePanelPointerDown = (
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      onPointerDown?.(event);
      if (
        !open ||
        event.defaultPrevented ||
        event.pointerType !== "touch" ||
        event.button !== 0 ||
        dragSessionRef.current !== null ||
        isIgnoredPanelDragTarget(event.target)
      ) {
        return;
      }

      beginPanelDragSession(
        "pointer",
        event.pointerId,
        event.clientX,
        event.clientY,
        event.target,
      );

      const handleMove = (moveEvent: PointerEvent) => {
        const session = dragSessionRef.current;
        if (session?.kind !== "pointer" || moveEvent.pointerId !== session.id) {
          return;
        }
        continuePanelDrag(moveEvent.clientX, moveEvent.clientY, moveEvent);
      };
      const handleEnd = (endEvent: PointerEvent) => {
        const session = dragSessionRef.current;
        if (session?.kind !== "pointer" || endEvent.pointerId !== session.id) {
          return;
        }
        finishPanelDrag(endEvent);
      };
      const handleCancel = (cancelEvent: PointerEvent) => {
        const session = dragSessionRef.current;
        if (
          session?.kind !== "pointer" ||
          cancelEvent.pointerId !== session.id
        ) {
          return;
        }
        cancelPanelDrag();
      };

      const removeListeners = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
        window.removeEventListener("pointercancel", handleCancel);
      };
      window.addEventListener("pointermove", handleMove, { passive: false });
      window.addEventListener("pointerup", handleEnd);
      window.addEventListener("pointercancel", handleCancel);
      removeDragListenersRef.current = removeListeners;
    };

    const handlePanelTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
      onTouchStart?.(event);
      if (
        !open ||
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        isIgnoredPanelDragTarget(event.target)
      ) {
        return;
      }
      const currentSession = dragSessionRef.current;
      if (currentSession !== null) {
        if (currentSession.kind !== "pointer") {
          return;
        }
        // The derived pointer session for this same touch gets cancelled the
        // moment the browser claims the pan; hand the gesture to the touch
        // path, which can preventDefault its way through.
        clearDragSession();
      }
      const touch = event.touches.item(0);
      if (touch === null) {
        return;
      }

      beginPanelDragSession(
        "touch",
        touch.identifier,
        touch.clientX,
        touch.clientY,
        event.target,
      );

      const handleTouchMove = (moveEvent: TouchEvent) => {
        const session = dragSessionRef.current;
        if (session?.kind !== "touch") {
          return;
        }
        const trackedTouch = getTrackedSwipeTouch(moveEvent, session.id);
        if (trackedTouch === null) {
          return;
        }
        continuePanelDrag(
          trackedTouch.clientX,
          trackedTouch.clientY,
          moveEvent,
        );
      };
      const handleTouchEnd = (endEvent: TouchEvent) => {
        const session = dragSessionRef.current;
        if (
          session?.kind !== "touch" ||
          getTrackedSwipeTouch(endEvent, session.id) === null
        ) {
          return;
        }
        finishPanelDrag(endEvent);
      };
      const handleTouchCancel = (cancelEvent: TouchEvent) => {
        const session = dragSessionRef.current;
        if (
          session?.kind !== "touch" ||
          getTrackedSwipeTouch(cancelEvent, session.id) === null
        ) {
          return;
        }
        cancelPanelDrag();
      };

      const removeListeners = () => {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
        window.removeEventListener("touchcancel", handleTouchCancel);
      };
      window.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      window.addEventListener("touchend", handleTouchEnd);
      window.addEventListener("touchcancel", handleTouchCancel);
      removeDragListenersRef.current = removeListeners;
    };

    const suppressedOpenTransitionStyle =
      open && suppressOpenAnimation
        ? ({ transition: "none" } satisfies React.CSSProperties)
        : undefined;

    return (
      <>
        <div
          ref={backdropRef}
          data-sidebar-mobile-backdrop=""
          data-testid="sidebar-mobile-backdrop"
          data-state={open ? "open" : "closed"}
          className={cn(
            "fixed inset-0 z-40 bg-black/80 will-change-[opacity]",
            SIDEBAR_MOBILE_BACKDROP_TRANSITION_CLASS,
            "data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0",
          )}
          style={{ ...suppressedOpenTransitionStyle, ...backdropStyle }}
          onClick={onDismiss}
        />
        <div
          ref={setPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Sidebar"
          tabIndex={-1}
          inert={!open}
          data-sidebar="panel"
          data-sidebar-state={open ? "expanded" : "collapsed"}
          data-state={open ? "open" : "closed"}
          data-collapsible=""
          data-variant="sidebar"
          data-side="left"
          // Kept although vaul is gone: SidebarInset's swipe helpers and the
          // swipe-target guards select the mobile panel by this attribute.
          data-vaul-drawer-direction="left"
          className={cn(
            // Fixed: a percentage height would resolve against the short
            // initial containing block, so it reads the shell unit directly.
            // touch-pan-y hands horizontal touch moves to the drag-to-close
            // handler while leaving vertical list scrolling native.
            "group fixed inset-y-0 z-40 flex h-(--bb-shell-height) w-(--sidebar-width-mobile) touch-pan-y select-none flex-col bg-sidebar text-sidebar-foreground outline-none will-change-[translate]",
            SIDEBAR_MOBILE_PANEL_TRANSITION_CLASS,
            "left-0 data-[state=closed]:-translate-x-full",
            "border-border-seam data-[side=left]:border-r data-[side=right]:border-l",
            className,
          )}
          style={
            {
              ...sidebarMobileWidthStyle,
              ...style,
              ...suppressedOpenTransitionStyle,
              ...panelMotionStyle,
            } as SidebarMobileWidthStyle
          }
          onPointerDown={handlePanelPointerDown}
          onTouchStart={handlePanelTouchStart}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </>
    );
  },
);
SidebarMobilePanel.displayName = "SidebarMobilePanel";

const SidebarTrigger = React.forwardRef<
  React.ComponentRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, "aria-expanded": ariaExpanded, ...props }, ref) => {
  const { isCompactViewport, open, openMobile, toggleSidebar } = useSidebar();

  return (
    <Button
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn(
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        "select-none",
        className,
      )}
      aria-expanded={ariaExpanded ?? (isCompactViewport ? openMobile : open)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <Icon name="PanelLeft" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarInset = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"main">
>(({ className, ...props }, ref) => {
  const {
    isCompactViewport,
    openMobile,
    setOpenMobile,
    openMobileSidebar,
    setSuppressMobileOpenAnimation,
    setSuppressMobileCloseAnimation,
  } = useSidebar();
  const swipeSessionRef = React.useRef<SidebarInsetSwipeSession | null>(null);
  const removeSwipeListenersRef = React.useRef<(() => void) | null>(null);
  const removeSwipeClickSuppressorRef = React.useRef<(() => void) | null>(null);
  const swipeClickSuppressorTimeoutRef = React.useRef<number | null>(null);
  const wheelSwipeDeltaRef = React.useRef(0);
  const wheelSwipeResetTimeoutRef = React.useRef<number | null>(null);
  const mobileDragSettleTimeoutRef = React.useRef<number | null>(null);

  const clearSwipeSession = React.useCallback(() => {
    removeSwipeListenersRef.current?.();
    removeSwipeListenersRef.current = null;
    swipeSessionRef.current = null;
  }, []);

  const clearMobileDragSettleTimeout = React.useCallback(() => {
    if (mobileDragSettleTimeoutRef.current !== null) {
      window.clearTimeout(mobileDragSettleTimeoutRef.current);
      mobileDragSettleTimeoutRef.current = null;
    }
  }, []);

  const clearWheelSwipe = React.useCallback(() => {
    wheelSwipeDeltaRef.current = 0;
    if (wheelSwipeResetTimeoutRef.current !== null) {
      window.clearTimeout(wheelSwipeResetTimeoutRef.current);
      wheelSwipeResetTimeoutRef.current = null;
    }
  }, []);

  const suppressNextSwipeClick = React.useCallback(() => {
    removeSwipeClickSuppressorRef.current?.();
    if (swipeClickSuppressorTimeoutRef.current !== null) {
      window.clearTimeout(swipeClickSuppressorTimeoutRef.current);
      swipeClickSuppressorTimeoutRef.current = null;
    }

    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      removeSwipeClickSuppressorRef.current?.();
    };
    const removeSuppressor = () => {
      window.removeEventListener("click", suppressClick, {
        capture: true,
      });
      removeSwipeClickSuppressorRef.current = null;
      if (swipeClickSuppressorTimeoutRef.current !== null) {
        window.clearTimeout(swipeClickSuppressorTimeoutRef.current);
        swipeClickSuppressorTimeoutRef.current = null;
      }
    };

    window.addEventListener("click", suppressClick, {
      capture: true,
      once: true,
    });
    removeSwipeClickSuppressorRef.current = removeSuppressor;
    swipeClickSuppressorTimeoutRef.current = window.setTimeout(
      removeSuppressor,
      400,
    );
  }, []);

  const settleMobileSwipe = React.useCallback(
    (open: boolean) => {
      clearMobileDragSettleTimeout();
      applySidebarMobileDragStyles({
        progress: open ? 1 : 0,
        settling: true,
      });
      mobileDragSettleTimeoutRef.current = window.setTimeout(() => {
        mobileDragSettleTimeoutRef.current = null;
        if (open) {
          setSuppressMobileOpenAnimation(true);
          clearSidebarMobileDragStyles();
        } else {
          flushSync(() => {
            setSuppressMobileCloseAnimation(true);
            setOpenMobile(false);
          });
          clearSidebarMobileDragAttributes();
        }
      }, SIDEBAR_MOBILE_DRAG_SETTLE_MS);
    },
    [
      clearMobileDragSettleTimeout,
      setOpenMobile,
      setSuppressMobileCloseAnimation,
      setSuppressMobileOpenAnimation,
    ],
  );

  const continueSwipe = React.useCallback(
    (clientX: number, clientY: number, event: PointerEvent | TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null) {
        return;
      }

      const deltaX = clientX - session.startX;
      const deltaY = clientY - session.startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const nowMs = Date.now();

      if (
        !session.isDragging &&
        absDeltaY > SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX &&
        absDeltaY > absDeltaX * 1.15
      ) {
        clearSidebarMobileDragStyles();
        clearSwipeSession();
        return;
      }

      const progress = clampSidebarMobileSwipeProgress(
        deltaX / session.panelWidth,
      );

      if (!session.isDragging) {
        if (
          deltaX < SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX ||
          absDeltaX <= absDeltaY * 1.25
        ) {
          return;
        }

        // A live timeline update can detach the start target mid-gesture. A
        // detached element reports empty computed style, so the probe below
        // would wrongly pass; cancel the swipe instead of guessing.
        if (
          session.startTarget !== null &&
          (!session.startTarget.isConnected ||
            isInsideHorizontalScrollRegion(session.startTarget))
        ) {
          clearSidebarMobileDragStyles();
          clearSwipeSession();
          return;
        }

        session.isDragging = true;
        clearMobileDragSettleTimeout();
        flushSync(() => {
          setSuppressMobileOpenAnimation(true);
          setSuppressMobileCloseAnimation(false);
          setOpenMobile(true);
        });
      }

      if (session.canPreventDefault && event.cancelable) {
        event.preventDefault();
      }

      const elapsedMs = nowMs - session.lastTimeMs;
      if (elapsedMs > 0) {
        session.velocityX =
          ((clientX - session.lastClientX) / elapsedMs) * 1000;
        session.lastClientX = clientX;
        session.lastTimeMs = nowMs;
      }
      session.lastProgress = progress;
      applySidebarMobileDragStyles({ progress, settling: false });
    },
    [
      clearMobileDragSettleTimeout,
      clearSwipeSession,
      setOpenMobile,
      setSuppressMobileCloseAnimation,
      setSuppressMobileOpenAnimation,
    ],
  );

  const handleSwipeMove = React.useCallback(
    (event: PointerEvent) => {
      const session = swipeSessionRef.current;
      if (
        session === null ||
        session.kind !== "pointer" ||
        event.pointerId !== session.id
      ) {
        return;
      }

      continueSwipe(event.clientX, event.clientY, event);
    },
    [continueSwipe],
  );

  const finishMobileSwipe = React.useCallback(
    (event: PointerEvent | TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null) {
        return;
      }

      clearSwipeSession();
      if (!session.isDragging) {
        clearSidebarMobileDragStyles();
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      suppressNextSwipeClick();
      settleMobileSwipe(shouldOpenSidebarMobileSwipe(session));
    },
    [clearSwipeSession, settleMobileSwipe, suppressNextSwipeClick],
  );

  const handleSwipeEnd = React.useCallback(
    (event: PointerEvent) => {
      const session = swipeSessionRef.current;
      if (
        session === null ||
        session.kind !== "pointer" ||
        event.pointerId !== session.id
      ) {
        return;
      }

      finishMobileSwipe(event);
    },
    [finishMobileSwipe],
  );

  const handleTouchMove = React.useCallback(
    (event: TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null || session.kind !== "touch") {
        return;
      }

      const touch = getTrackedSwipeTouch(event, session.id);
      if (touch == null) {
        return;
      }

      continueSwipe(touch.clientX, touch.clientY, event);
    },
    [continueSwipe],
  );

  const handleTouchEnd = React.useCallback(
    (event: TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null || session.kind !== "touch") {
        return;
      }

      if (getTrackedSwipeTouch(event, session.id) === null) {
        return;
      }

      finishMobileSwipe(event);
    },
    [finishMobileSwipe],
  );

  const startTouchSwipe = React.useCallback(
    (event: TouchEvent) => {
      if (
        event.defaultPrevented ||
        !isCompactViewport ||
        openMobile ||
        event.touches.length !== 1 ||
        !isSidebarInsetSwipeTarget(event.target) ||
        shouldIgnoreSidebarSwipeTarget(event.target)
      ) {
        return;
      }

      const touch = event.touches.item(0);
      if (
        touch == null ||
        touch.clientX < SIDEBAR_MOBILE_SWIPE_BROWSER_EDGE_GUARD_PX
      ) {
        return;
      }

      const currentSession = swipeSessionRef.current;
      if (currentSession !== null) {
        if (currentSession.kind !== "pointer") {
          return;
        }
        clearSwipeSession();
      }

      // Only an edge-zone touch may take the non-passive path. A touch that
      // starts deeper in the timeline is almost always a scroll; registering
      // a non-passive `touchmove` for it made iOS Safari and Chrome Android
      // dispatch that scroll's first move synchronously through the main
      // thread, which under streaming load delayed every scroll start. The
      // deep touch keeps its swipe recognizer, but on a passive listener.
      const canPreventDefault = isSidebarSwipeEdgeZoneTouch(touch.clientX);
      swipeSessionRef.current = createSidebarInsetSwipeSession({
        kind: "touch",
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        selectionRoot: getSidebarSwipeSelectionRoot(event.target),
        startTarget: event.target instanceof Element ? event.target : null,
        canPreventDefault,
      });

      const removeListeners = () => {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
        window.removeEventListener("touchcancel", handleTouchEnd);
      };
      window.addEventListener("touchmove", handleTouchMove, {
        passive: !canPreventDefault,
      });
      window.addEventListener("touchend", handleTouchEnd);
      window.addEventListener("touchcancel", handleTouchEnd);
      removeSwipeListenersRef.current = removeListeners;
    },
    [
      clearSwipeSession,
      handleTouchEnd,
      handleTouchMove,
      isCompactViewport,
      openMobile,
    ],
  );

  const startPointerSwipe = React.useCallback(
    (event: PointerEvent) => {
      if (
        event.defaultPrevented ||
        !isCompactViewport ||
        openMobile ||
        event.pointerType !== "touch" ||
        event.button !== 0 ||
        event.clientX < SIDEBAR_MOBILE_SWIPE_BROWSER_EDGE_GUARD_PX ||
        swipeSessionRef.current !== null ||
        !isSidebarInsetSwipeTarget(event.target) ||
        shouldIgnoreSidebarSwipeTarget(event.target)
      ) {
        return;
      }

      swipeSessionRef.current = createSidebarInsetSwipeSession({
        kind: "pointer",
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        selectionRoot: getSidebarSwipeSelectionRoot(event.target),
        startTarget: event.target instanceof Element ? event.target : null,
        // `pointermove` is never scroll-blocking, so preventDefault is free.
        canPreventDefault: true,
      });

      const removeListeners = () => {
        window.removeEventListener("pointermove", handleSwipeMove);
        window.removeEventListener("pointerup", handleSwipeEnd);
        window.removeEventListener("pointercancel", handleSwipeEnd);
      };
      window.addEventListener("pointermove", handleSwipeMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleSwipeEnd);
      window.addEventListener("pointercancel", handleSwipeEnd);
      removeSwipeListenersRef.current = removeListeners;
    },
    [handleSwipeEnd, handleSwipeMove, isCompactViewport, openMobile],
  );

  React.useEffect(() => {
    const cancelSwipeForTextSelection = () => {
      const selectionRoot = swipeSessionRef.current?.selectionRoot;
      if (
        selectionRoot !== null &&
        selectionRoot !== undefined &&
        hasExpandedTextSelectionWithin(selectionRoot)
      ) {
        clearSwipeSession();
      }
    };

    document.addEventListener("pointerdown", startPointerSwipe, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", startTouchSwipe, {
      capture: true,
      passive: true,
    });
    document.addEventListener("selectionchange", cancelSwipeForTextSelection);
    return () => {
      document.removeEventListener("pointerdown", startPointerSwipe, {
        capture: true,
      });
      document.removeEventListener("touchstart", startTouchSwipe, {
        capture: true,
      });
      document.removeEventListener(
        "selectionchange",
        cancelSwipeForTextSelection,
      );
    };
  }, [clearSwipeSession, startPointerSwipe, startTouchSwipe]);

  const handleWheelSwipe = React.useCallback(
    (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        !isCompactViewport ||
        openMobile ||
        event.clientX < SIDEBAR_MOBILE_SWIPE_BROWSER_EDGE_GUARD_PX ||
        !isSidebarInsetSwipeTarget(event.target) ||
        shouldIgnoreSidebarSwipeTarget(event.target)
      ) {
        return;
      }

      const absDeltaX = Math.abs(event.deltaX);
      const absDeltaY = Math.abs(event.deltaY);
      if (
        absDeltaX < SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX ||
        absDeltaX <= absDeltaY * 1.25
      ) {
        return;
      }

      if (
        event.target instanceof Element &&
        isInsideHorizontalScrollRegion(event.target)
      ) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      wheelSwipeDeltaRef.current += event.deltaX;
      if (wheelSwipeResetTimeoutRef.current !== null) {
        window.clearTimeout(wheelSwipeResetTimeoutRef.current);
      }

      wheelSwipeResetTimeoutRef.current = window.setTimeout(() => {
        wheelSwipeDeltaRef.current = 0;
        wheelSwipeResetTimeoutRef.current = null;
      }, SIDEBAR_MOBILE_WHEEL_SWIPE_RESET_MS);

      if (
        Math.abs(wheelSwipeDeltaRef.current) <
        SIDEBAR_MOBILE_WHEEL_SWIPE_OPEN_DISTANCE_PX
      ) {
        return;
      }

      clearWheelSwipe();
      openMobileSidebar();
    },
    [clearWheelSwipe, isCompactViewport, openMobile, openMobileSidebar],
  );

  React.useEffect(() => {
    if (!isCompactViewport) {
      clearWheelSwipe();
      return;
    }

    document.addEventListener("wheel", handleWheelSwipe, {
      capture: true,
      passive: false,
    });
    return () => {
      document.removeEventListener("wheel", handleWheelSwipe, {
        capture: true,
      });
      clearWheelSwipe();
    };
  }, [clearWheelSwipe, handleWheelSwipe, isCompactViewport]);

  React.useEffect(
    () => () => {
      clearSwipeSession();
      removeSwipeClickSuppressorRef.current?.();
      if (swipeClickSuppressorTimeoutRef.current !== null) {
        window.clearTimeout(swipeClickSuppressorTimeoutRef.current);
        swipeClickSuppressorTimeoutRef.current = null;
      }
      clearWheelSwipe();
      clearMobileDragSettleTimeout();
      clearSidebarMobileDragStyles();
    },
    [clearMobileDragSettleTimeout, clearSwipeSession, clearWheelSwipe],
  );

  React.useEffect(() => {
    if (!isCompactViewport) {
      clearSwipeSession();
      clearSidebarMobileDragStyles();
      return;
    }

    if (openMobile && swipeSessionRef.current === null) {
      clearSwipeSession();
    }
  }, [clearSwipeSession, isCompactViewport, openMobile]);

  return (
    <main
      ref={ref}
      data-sidebar="inset"
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
        className,
      )}
      {...props}
    />
  );
});
SidebarInset.displayName = "SidebarInset";

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
});
SidebarFooter.displayName = "SidebarFooter";

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, children, ...props }, ref) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const setContentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  return (
    <div
      ref={setContentRef}
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    >
      <SidebarContentElementContext.Provider value={contentRef}>
        {children}
      </SidebarContentElementContext.Provider>
    </div>
  );
});
SidebarContent.displayName = "SidebarContent";

type SidebarStickyTierKind = "label" | "project" | "parent";

type SidebarStickyStackProps = React.ComponentProps<"div">;

interface SidebarStickyTierProps extends React.ComponentProps<"div"> {
  tier: SidebarStickyTierKind;
  // Depth among pinned parents (0 = first parent under the project/label).
  // Drives the CSS pin offset and z-index for the "parent" tier; the other
  // tiers are singular and ignore it.
  level?: number;
}

type SidebarStickyParentLevelStyle = React.CSSProperties & {
  "--bb-sidebar-sticky-parent-level": number;
};

const SidebarStickyStack = React.forwardRef<
  HTMLDivElement,
  SidebarStickyStackProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="group"
      data-sidebar-sticky-stack=""
      className={cn("relative flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  );
});
SidebarStickyStack.displayName = "SidebarStickyStack";

const SidebarStickyTier = React.forwardRef<
  HTMLDivElement,
  SidebarStickyTierProps
>(({ children, className, tier, level, style, ...props }, ref) => {
  const tierStyle =
    tier === "parent" && level !== undefined
      ? ({
          ...style,
          "--bb-sidebar-sticky-parent-level": level,
        } satisfies SidebarStickyParentLevelStyle)
      : style;
  return (
    <div
      ref={ref}
      {...props}
      style={tierStyle}
      data-sidebar={tier === "label" ? "group-label" : undefined}
      data-sidebar-sticky-tier={tier}
      className={cn(
        tier === "label" && SIDEBAR_GROUP_LABEL_BASE_CLASS,
        tier === "label" && SIDEBAR_GROUP_LABEL_COLLAPSED_CLASS,
        "bg-sidebar",
        className,
      )}
    >
      {children}
    </div>
  );
});
SidebarStickyTier.displayName = "SidebarStickyTier";

type SidebarStickyGroupProps = React.ComponentProps<"div">;

/**
 * The containing block for one sticky group: a sticky header tier plus its
 * collapsible body. CSS `position: sticky` only pushes a header out of the way
 * of the next one when each header is constrained by its own containing block —
 * sticky siblings that share a containing block pin at the same offset and
 * overlap instead. Every nesting level (section/label, project, parent thread,
 * worktree) wraps its header + body in one of these so the shove-out behavior
 * is structural, not per-tier boilerplate that a new tier can forget.
 */
const SidebarStickyGroup = React.forwardRef<
  HTMLDivElement,
  SidebarStickyGroupProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar-sticky-group=""
      className={cn(className)}
      {...props}
    />
  );
});
SidebarStickyGroup.displayName = "SidebarStickyGroup";

const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="group-content"
    className={cn("w-full text-sm", className)}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu"
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    {...props}
  />
));
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    data-sidebar="menu-item"
    className={cn("group/menu-item relative", className)}
    {...props}
  />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

const SIDEBAR_MENU_BUTTON_CLASS =
  "flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0";

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    tooltip?: React.ComponentProps<typeof TooltipContent>;
  }
>(({ asChild = false, tooltip, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  const { isCompactViewport, state } = useSidebar();

  const button = (
    <Comp
      ref={ref}
      data-sidebar="menu-button"
      className={cn(SIDEBAR_MENU_BUTTON_CLASS, className)}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isCompactViewport}
        {...tooltip}
      />
    </Tooltip>
  );
});
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuSkeleton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  const skeletonId = React.useId();

  // Stable varied width between 50 to 90%.
  const width = React.useMemo(() => {
    let hash = 0;
    for (let index = 0; index < skeletonId.length; index += 1) {
      hash = (hash + skeletonId.charCodeAt(index) * (index + 1)) % 40;
    }
    return `${hash + 50}%`;
  }, [skeletonId]);

  return (
    <div
      ref={ref}
      data-sidebar="menu-skeleton"
      className={cn("rounded-md h-8 flex gap-2 px-2 items-center", className)}
      {...props}
    >
      <Skeleton
        className="h-4 flex-1 max-w-[--skeleton-width]"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarStickyGroup,
  SidebarStickyStack,
  SidebarStickyTier,
  SidebarTrigger,
  useCloseMobileSidebar,
  useIsSidebarShowing,
  useOptionalIsSidebarShowing,
  useSidebar,
  useSidebarContentElementRef,
};
