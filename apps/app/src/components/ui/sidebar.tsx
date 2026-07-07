/* shadcn/ui-derived */
import * as React from "react";
import { flushSync } from "react-dom";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Drawer as DrawerPrimitive } from "vaul";

import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Input } from "@bb/shared-ui/input";
import { Separator } from "@bb/shared-ui/separator";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "min(90vw, 320px)";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_MOBILE_SWIPE_BROWSER_EDGE_GUARD_PX = 24;
const SIDEBAR_MOBILE_SWIPE_OPEN_INTENT_PX = 12;
const SIDEBAR_MOBILE_SWIPE_OPEN_RATIO = 0.33;
const SIDEBAR_MOBILE_SWIPE_OPEN_FLING_MIN_RATIO = 0.12;
const SIDEBAR_MOBILE_SWIPE_OPEN_FLING_VELOCITY_PX_PER_SEC = 450;
const SIDEBAR_MOBILE_DRAG_SETTLE_MS = 220;
const SIDEBAR_MOBILE_DRAG_SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const SIDEBAR_MOBILE_PANEL_SETTLE_TRANSITION = `transform ${SIDEBAR_MOBILE_DRAG_SETTLE_MS}ms ${SIDEBAR_MOBILE_DRAG_SETTLE_EASING}`;
const SIDEBAR_MOBILE_BACKDROP_SETTLE_TRANSITION = `opacity ${SIDEBAR_MOBILE_DRAG_SETTLE_MS}ms ${SIDEBAR_MOBILE_DRAG_SETTLE_EASING}`;
const SIDEBAR_MOBILE_WHEEL_SWIPE_OPEN_DISTANCE_PX = 90;
const SIDEBAR_MOBILE_WHEEL_SWIPE_RESET_MS = 250;
const SIDEBAR_GROUP_LABEL_BASE_CLASS =
  "duration-200 flex shrink-0 items-center rounded-md px-1 text-xs font-medium text-sidebar-foreground/75 outline-none ring-sidebar-ring transition-[margin,opa] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0";
const SIDEBAR_GROUP_LABEL_COLLAPSED_CLASS =
  "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0";
const SIDEBAR_GROUP_LABEL_HEIGHT_CLASS = "h-8";

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

function getSidebarMobilePanelTransform(
  progress: number,
  side: "left" | "right",
): string {
  const hiddenPercent = (1 - progress) * 100;
  return side === "left"
    ? `translate3d(-${hiddenPercent}%, 0, 0)`
    : `translate3d(${hiddenPercent}%, 0, 0)`;
}

function applySidebarMobileDragStyles({
  progress,
  settling,
}: {
  progress: number;
  settling: boolean;
}) {
  const { panel, backdrop } = getSidebarMobileMotionNodes();
  const side = panel?.dataset.side === "right" ? "right" : "left";

  if (panel !== null) {
    panel.setAttribute("data-vaul-animate", "false");
    panel.style.transform = getSidebarMobilePanelTransform(progress, side);
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
    panel.style.transform = "";
    panel.style.transition = "";
  }

  if (backdrop !== null) {
    backdrop.removeAttribute("data-vaul-animate");
    backdrop.style.opacity = "";
    backdrop.style.transition = "";
  }
}

function createSidebarInsetSwipeSession({
  kind,
  id,
  startX,
  startY,
}: {
  kind: "pointer" | "touch";
  id: number;
  startX: number;
  startY: number;
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
  };
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

  return isInsideHorizontalScrollRegion(target);
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

type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  suppressMobileOpenAnimation: boolean;
  setSuppressMobileOpenAnimation: (suppress: boolean) => void;
  suppressMobileCloseAnimation: boolean;
  setSuppressMobileCloseAnimation: (suppress: boolean) => void;
  isCompactViewport: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function useIsSidebarShowing() {
  const { state, isCompactViewport, openMobile } = useSidebar();
  return isCompactViewport ? openMobile : state === "expanded";
}

function useOptionalIsSidebarShowing() {
  const context = React.useContext(SidebarContext);
  if (context === null) {
    return null;
  }
  return context.isCompactViewport
    ? context.openMobile
    : context.state === "expanded";
}

/**
 * Stable callback that closes the mobile sidebar drawer. Every navigation
 * triggered from inside the sidebar must call this so the destination view is
 * revealed on compact viewports; on wider viewports the drawer state is
 * already closed and the call is a no-op.
 */
function useCloseMobileSidebar() {
  const { setOpenMobile } = useSidebar();
  return React.useCallback(() => setOpenMobile(false), [setOpenMobile]);
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
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
      return isCompactViewport
        ? setOpenMobile((open) => !open)
        : setOpen((open) => !open);
    }, [isCompactViewport, setOpen, setOpenMobile]);

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
        suppressMobileOpenAnimation,
        setSuppressMobileOpenAnimation,
        suppressMobileCloseAnimation,
        setSuppressMobileCloseAnimation,
        toggleSidebar,
      ],
    );

    return (
      <SidebarContext.Provider value={contextValue}>
        {/* Match the agent message action bar's tooltip timing (300ms open
            delay + Radix's default skip window) so sidebar icon tooltips feel
            the same instead of flashing instantly on hover. disableHoverableContent
            dismisses the tooltip the moment the pointer leaves the trigger, so it
            never lingers/floats while the mouse moves on. */}
        <TooltipProvider delayDuration={300} disableHoverableContent>
          <div
            style={
              {
                "--sidebar-width": SIDEBAR_WIDTH,
                "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                ...style,
              } as React.CSSProperties
            }
            className={cn(
              "group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar",
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
  }
>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const {
      isCompactViewport,
      state,
      openMobile,
      setOpenMobile,
      suppressMobileOpenAnimation,
      setSuppressMobileOpenAnimation,
      suppressMobileCloseAnimation,
      setSuppressMobileCloseAnimation,
    } = useSidebar();
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
          transform:
            side === "left"
              ? "translate3d(-100%, 0, 0)"
              : "translate3d(100%, 0, 0)",
          transition: "none",
        };
      }

      return undefined;
    }, [shouldSuppressMobileCloseAnimation, side]);
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

    if (collapsible === "none") {
      return (
        <div
          className={cn(
            "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
            className,
          )}
          ref={ref}
          style={style}
          {...props}
        >
          {children}
        </div>
      );
    }

    if (isCompactViewport) {
      return (
        <DrawerPrimitive.Root
          open={openMobile}
          onOpenChange={handleOpenMobileChange}
          direction={side}
          closeThreshold={0.25}
          dismissible
          modal
          shouldScaleBackground={false}
        >
          <DrawerPrimitive.Portal>
            <DrawerPrimitive.Overlay
              data-sidebar-mobile-backdrop=""
              data-testid="sidebar-mobile-backdrop"
              data-sidebar-suppress-open-animation={
                suppressMobileOpenAnimation ? "true" : undefined
              }
              className="fixed inset-0 z-40 bg-black/80 data-[state=closed]:pointer-events-none [&[data-sidebar-suppress-open-animation=true][data-state=open]]:![animation:none]"
              style={mobileBackdropStyle}
            />
            <DrawerPrimitive.Content
              ref={ref}
              data-sidebar="panel"
              data-sidebar-state={openMobile ? "expanded" : "collapsed"}
              data-collapsible=""
              data-variant={variant}
              data-side={side}
              data-sidebar-suppress-open-animation={
                suppressMobileOpenAnimation ? "true" : undefined
              }
              className={cn(
                "group fixed inset-y-0 z-40 flex h-svh w-(--sidebar-width-mobile) flex-col bg-sidebar text-sidebar-foreground outline-none",
                "[&[data-sidebar-suppress-open-animation=true][data-state=open]]:![animation:none]",
                side === "left" ? "left-0" : "right-0",
                variant === "floating" || variant === "inset"
                  ? "p-2"
                  : "border-border-seam-vertical data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:border-l",
                className,
              )}
              style={
                {
                  ...sidebarMobileWidthStyle,
                  ...style,
                  ...mobilePanelMotionStyle,
                } as SidebarMobileWidthStyle
              }
              {...props}
            >
              <DrawerPrimitive.Title className="sr-only">
                Sidebar
              </DrawerPrimitive.Title>
              <DrawerPrimitive.Description className="sr-only">
                Application navigation
              </DrawerPrimitive.Description>
              <div
                data-sidebar="sidebar"
                className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
              >
                {children}
              </div>
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Portal>
        </DrawerPrimitive.Root>
      );
    }

    return (
      <div
        ref={ref}
        className="group peer text-sidebar-foreground"
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          data-sidebar="gap"
          className={cn(
            "relative hidden h-svh w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear md:block",
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            variant === "floating" || variant === "inset"
              ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
              : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          )}
        />
        <div
          data-sidebar="panel"
          className={cn(
            "fixed inset-y-0 z-10 flex h-svh w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground transition-[left,right,width] duration-200 ease-linear",
            side === "left"
              ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
              : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
            // Adjust the padding for floating and inset variants.
            variant === "floating" || variant === "inset"
              ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
              : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) border-border-seam-vertical group-data-[side=left]:border-r group-data-[side=right]:border-l",
            className,
          )}
          style={style}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Sidebar.displayName = "Sidebar";

const SidebarTrigger = React.forwardRef<
  React.ComponentRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn(COARSE_POINTER_HEADER_ICON_BUTTON_CLASS, className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <Icon name="PanelLeft" className="max-md:pointer-coarse:hidden" />
      <Icon name="AlignLeft" className="hidden max-md:pointer-coarse:block" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarRail = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button">
>(({ className, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      ref={ref}
      data-sidebar="rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex",
        "[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className,
      )}
      {...props}
    />
  );
});
SidebarRail.displayName = "SidebarRail";

const SidebarInset = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"main">
>(({ className, ...props }, ref) => {
  const {
    isCompactViewport,
    openMobile,
    setOpenMobile,
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

        session.isDragging = true;
        clearMobileDragSettleTimeout();
        flushSync(() => {
          setSuppressMobileOpenAnimation(true);
          setSuppressMobileCloseAnimation(false);
          setOpenMobile(true);
        });
      }

      if (event.cancelable) {
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

      swipeSessionRef.current = createSidebarInsetSwipeSession({
        kind: "touch",
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
      });

      const removeListeners = () => {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
        window.removeEventListener("touchcancel", handleTouchEnd);
      };
      window.addEventListener("touchmove", handleTouchMove, {
        passive: false,
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
    document.addEventListener("pointerdown", startPointerSwipe, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", startTouchSwipe, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("pointerdown", startPointerSwipe, {
        capture: true,
      });
      document.removeEventListener("touchstart", startTouchSwipe, {
        capture: true,
      });
    };
  }, [startPointerSwipe, startTouchSwipe]);

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
      setOpenMobile(true);
    },
    [clearWheelSwipe, isCompactViewport, openMobile, setOpenMobile],
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
        "relative flex min-h-svh min-w-0 flex-1 flex-col bg-background",
        "peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
        className,
      )}
      {...props}
    />
  );
});
SidebarInset.displayName = "SidebarInset";

const SidebarInput = React.forwardRef<
  React.ComponentRef<typeof Input>,
  React.ComponentProps<typeof Input>
>(({ className, ...props }, ref) => {
  return (
    <Input
      ref={ref}
      data-sidebar="input"
      className={cn(
        "h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        className,
      )}
      {...props}
    />
  );
});
SidebarInput.displayName = "SidebarInput";

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
});
SidebarHeader.displayName = "SidebarHeader";

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

const SidebarSeparator = React.forwardRef<
  React.ComponentRef<typeof Separator>,
  React.ComponentProps<typeof Separator>
>(({ className, ...props }, ref) => {
  return (
    <Separator
      ref={ref}
      data-sidebar="separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  );
});
SidebarSeparator.displayName = "SidebarSeparator";

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarContent.displayName = "SidebarContent";

const SidebarGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
});
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      ref={ref}
      data-sidebar="group-label"
      className={cn(
        SIDEBAR_GROUP_LABEL_BASE_CLASS,
        SIDEBAR_GROUP_LABEL_HEIGHT_CLASS,
        SIDEBAR_GROUP_LABEL_COLLAPSED_CLASS,
        className,
      )}
      {...props}
    />
  );
});
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export type SidebarStickyTierKind = "label" | "project" | "parent";

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

interface SidebarStickyGroupProps extends React.ComponentProps<"div"> {
  asChild?: boolean;
}

/**
 * The containing block for one sticky group: a sticky header tier plus its
 * collapsible body. CSS `position: sticky` only pushes a header out of the way
 * of the next one when each header is constrained by its own containing block —
 * sticky siblings that share a containing block pin at the same offset and
 * overlap instead. Every nesting level (section/label, project, parent thread,
 * worktree) wraps its header + body in one of these so the shove-out behavior
 * is structural, not per-tier boilerplate that a new tier can forget.
 *
 * Pass `asChild` to project the wrapper onto a caller-owned element (e.g. the
 * project tier's `<li>` SidebarMenuItem) instead of emitting a `<div>`.
 */
const SidebarStickyGroup = React.forwardRef<
  HTMLDivElement,
  SidebarStickyGroupProps
>(({ asChild = false, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-sidebar-sticky-group=""
      className={cn(className)}
      {...props}
    />
  );
});
SidebarStickyGroup.displayName = "SidebarStickyGroup";

const SidebarGroupAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-sidebar="group-action"
      className={cn(
        "absolute right-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarGroupAction.displayName = "SidebarGroupAction";

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

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-border/70 data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:hover:bg-sidebar-border/70 data-[active=true]:hover:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  } & VariantProps<typeof sidebarMenuButtonVariants>
>(
  (
    {
      asChild = false,
      isActive = false,
      variant = "default",
      size = "default",
      tooltip,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const { isCompactViewport, state } = useSidebar();

    const button = (
      <Comp
        ref={ref}
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    );

    if (!tooltip) {
      return button;
    }

    if (typeof tooltip === "string") {
      tooltip = {
        children: tooltip,
      };
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
  },
);
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    showOnHover?: boolean;
  }
>(({ className, asChild = false, showOnHover = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-sidebar="menu-action"
      className={cn(
        "absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "group-hover/menu-item:opacity-100 group-has-[:focus-visible]/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuAction.displayName = "SidebarMenuAction";

const SidebarMenuBadge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<"span">
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-sidebar="menu-badge"
    className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium leading-none tabular-nums text-sidebar-foreground select-none pointer-events-none",
      className,
    )}
    {...props}
  />
));
SidebarMenuBadge.displayName = "SidebarMenuBadge";

const SidebarMenuSkeleton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    showIcon?: boolean;
  }
>(({ className, showIcon = false, ...props }, ref) => {
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
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
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

const SidebarMenuSub = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu-sub"
    className={cn(
      "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
      "group-data-[collapsible=icon]:hidden",
      className,
    )}
    {...props}
  />
));
SidebarMenuSub.displayName = "SidebarMenuSub";

const SidebarMenuSubItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ ...props }, ref) => <li ref={ref} {...props} />);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

const SidebarMenuSubButton = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<"a"> & {
    asChild?: boolean;
    size?: "sm" | "md";
    isActive?: boolean;
  }
>(({ asChild = false, size = "md", isActive, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a";

  return (
    <Comp
      ref={ref}
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarStickyGroup,
  SidebarStickyStack,
  SidebarStickyTier,
  SidebarTrigger,
  useCloseMobileSidebar,
  useIsSidebarShowing,
  useOptionalIsSidebarShowing,
  useSidebar,
};
