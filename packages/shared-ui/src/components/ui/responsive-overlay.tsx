import * as React from "react";
import { createPortal } from "react-dom";
import { Slot } from "@radix-ui/react-slot";

import { Drawer, DrawerContent, DrawerTitle } from "./drawer.js";
import {
  blurActiveKeyboardInputBeforeOverlayOpen,
  blurActiveKeyboardInputBeforeOverlayClose,
  blurActiveKeyboardInputWithin,
  getOverlayTriggerClassName,
  preventOverlayTriggerSelection,
} from "./overlay-trigger.js";
import { useIsCompactViewport } from "./hooks/use-compact-viewport.js";
import { usePointerCoarse } from "./hooks/use-pointer-coarse.js";
import { usePortalScopeProps } from "../../lib/portal-scope.js";
import { cn } from "../../lib/utils.js";

// ---------------------------------------------------------------------------
// Shared context value for responsive overlays (dropdown menus, popovers)
// ---------------------------------------------------------------------------

export interface ResponsiveOverlayContextValue {
  isCompactViewport: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ResponsiveDrawerDepthContext = React.createContext(0);
const SONNER_TOASTER_SELECTOR = "[data-sonner-toaster]";

type DrawerContentPointerDownOutsideEvent = Parameters<
  NonNullable<
    React.ComponentPropsWithoutRef<typeof DrawerContent>["onPointerDownOutside"]
  >
>[0];

function resetDrawerKeyboardStyles(drawerElement: HTMLElement | null): void {
  if (drawerElement === null) return;

  drawerElement.style.height = "";
  drawerElement.style.bottom = "";
}

function isSonnerToasterPointerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(SONNER_TOASTER_SELECTOR) !== null
  );
}

// ---------------------------------------------------------------------------
// Hook: manages open state, mobile detection, and breakpoint-cross close.
// One useMediaQuery subscription per Root (not two).
// ---------------------------------------------------------------------------

export function useResponsiveRoot(
  controlledOpen: boolean | undefined,
  controlledOnChange: ((open: boolean) => void) | undefined,
  defaultOpen: boolean = false,
): ResponsiveOverlayContextValue {
  const isCompactViewport = useIsCompactViewport();
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const onOpenChange = React.useCallback(
    (next: boolean) => {
      if (open && !next && isCompactViewport) {
        blurActiveKeyboardInputBeforeOverlayClose();
      }
      if (!isControlled) {
        setInternalOpen(next);
      }
      controlledOnChange?.(next);
    },
    [isCompactViewport, isControlled, controlledOnChange, open],
  );

  return React.useMemo(
    () => ({ isCompactViewport, open, onOpenChange }),
    [isCompactViewport, open, onOpenChange],
  );
}

// ---------------------------------------------------------------------------
// MobileTrigger: shared trigger for mobile overlays.
// Adds aria-expanded, aria-haspopup, and data-state that Radix normally
// provides on desktop but which are missing from a bare <button>.
// ---------------------------------------------------------------------------

interface MobileTriggerProps {
  asChild?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  haspopup: "menu" | "dialog";
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export const MobileTrigger = React.forwardRef<
  HTMLButtonElement,
  MobileTriggerProps &
    Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      keyof MobileTriggerProps
    >
>(
  (
    {
      asChild,
      open,
      onOpenChange,
      haspopup,
      onClick,
      children,
      className,
      ...domProps
    },
    ref,
  ) => {
    const triggerClassName = getOverlayTriggerClassName(className);
    const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
      onClick?.(e);
      if (!e.defaultPrevented) {
        if (!open) {
          blurActiveKeyboardInputBeforeOverlayOpen();
        }
        onOpenChange(!open);
      }
    };

    const ariaProps = {
      "aria-expanded": open,
      "aria-haspopup": haspopup,
      "data-state": open ? "open" : "closed",
    } as const;

    if (asChild) {
      return (
        <Slot
          ref={ref}
          onClick={handleClick}
          onMouseDown={preventOverlayTriggerSelection}
          className={triggerClassName}
          {...ariaProps}
          {...domProps}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        onClick={handleClick}
        onMouseDown={preventOverlayTriggerSelection}
        className={triggerClassName}
        {...ariaProps}
        {...domProps}
      >
        {children}
      </button>
    );
  },
);
MobileTrigger.displayName = "MobileTrigger";

// ---------------------------------------------------------------------------
// stripRadixContentProps: removes Radix positioning/behavior props from a
// props object so that only DOM-compatible props remain for mobile rendering.
// Derived from a single const to prevent interface/set drift.
// ---------------------------------------------------------------------------

const RADIX_CONTENT_PROP_NAMES = [
  "side",
  "sideOffset",
  "align",
  "alignOffset",
  "collisionPadding",
  "collisionBoundary",
  "arrowPadding",
  "sticky",
  "hideWhenDetached",
  "avoidCollisions",
  "onOpenAutoFocus",
  "onCloseAutoFocus",
  "onEscapeKeyDown",
  "onPointerDownOutside",
  "onFocusOutside",
  "onInteractOutside",
] as const;

type RadixContentPropName = (typeof RADIX_CONTENT_PROP_NAMES)[number];

const RADIX_CONTENT_KEYS: ReadonlySet<string> = new Set(
  RADIX_CONTENT_PROP_NAMES,
);

export function stripRadixContentProps<T extends Record<string, unknown>>(
  props: T,
): Omit<T, RadixContentPropName> {
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    if (!RADIX_CONTENT_KEYS.has(key)) {
      result[key] = props[key];
    }
  }
  return result as Omit<T, RadixContentPropName>;
}

// ---------------------------------------------------------------------------
// ResponsiveDrawerShell: shared scaffold for the mobile branch of any
// responsive overlay. Wraps children in Drawer > DrawerContent, with an
// optional sr-only DrawerTitle. Callers supply the body (ref, padding,
// className, etc.) since those differ between Dialog, Popover, DropdownMenu,
// and ThreadDetailSecondaryContent.
// ---------------------------------------------------------------------------

interface ResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Sr-only label announced when the drawer opens. Omit if the caller
   * renders its own labeled heading inside children (e.g. DialogTitle).
   */
  srLabel?: string;
  /** Class name on the DrawerContent wrapper. */
  contentClassName?: string;
  /**
   * When true, the drawer can only be dragged via the handle bar. Pointer
   * events on the content area are not consumed by vaul, which would
   * otherwise call setPointerCapture on the click target and break clicks
   * inside web components (e.g. Pierre tree's shadow DOM).
   */
  handleOnly?: boolean;
  /**
   * Whether Vaul should mutate drawer height/bottom around focused inputs when
   * the visual viewport changes. Defaults off for nested drawers because the
   * parent drawer cannot distinguish a nested drawer's focused input.
   */
  repositionInputs?: boolean;
  /** Called when the DrawerContent element's own animation completes. */
  onContentAnimationEnd?: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveDrawerShell({
  open,
  onOpenChange,
  srLabel,
  contentClassName,
  handleOnly,
  repositionInputs,
  onContentAnimationEnd,
  children,
}: ResponsiveDrawerShellProps) {
  const parentDrawerDepth = React.useContext(ResponsiveDrawerDepthContext);
  const drawerContentRef = React.useRef<HTMLDivElement>(null);
  const isPointerCoarse = usePointerCoarse();
  const isNestedDrawer = parentDrawerDepth > 0;
  const shouldRepositionInputs = repositionInputs ?? !isNestedDrawer;
  const resetClosingKeyboardState = React.useCallback(() => {
    blurActiveKeyboardInputWithin(drawerContentRef.current);
    resetDrawerKeyboardStyles(drawerContentRef.current);
  }, []);
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetClosingKeyboardState();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetClosingKeyboardState],
  );
  const handleContentAnimationEnd = React.useCallback<
    React.AnimationEventHandler<HTMLDivElement>
  >(
    (event) => {
      if (event.currentTarget !== event.target) {
        return;
      }
      onContentAnimationEnd?.(open);
    },
    [onContentAnimationEnd, open],
  );
  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      if (isPointerCoarse) {
        event.preventDefault();
      }
    },
    [isPointerCoarse],
  );
  const handlePointerDownOutside = React.useCallback(
    (event: DrawerContentPointerDownOutsideEvent) => {
      if (isSonnerToasterPointerTarget(event.detail.originalEvent.target)) {
        event.preventDefault();
      }
    },
    [],
  );
  const previousOpenRef = React.useRef(open);

  React.useLayoutEffect(() => {
    if (previousOpenRef.current && !open) {
      resetClosingKeyboardState();
    }
    previousOpenRef.current = open;
  }, [open, resetClosingKeyboardState]);

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      handleOnly={handleOnly}
      nested={isNestedDrawer}
      repositionInputs={shouldRepositionInputs}
    >
      <DrawerContent
        ref={drawerContentRef}
        className={contentClassName}
        onAnimationEnd={handleContentAnimationEnd}
        onOpenAutoFocus={handleOpenAutoFocus}
        onPointerDownOutside={handlePointerDownOutside}
      >
        <ResponsiveDrawerDepthContext.Provider value={parentDrawerDepth + 1}>
          {srLabel !== undefined ? (
            <DrawerTitle className="sr-only">{srLabel}</DrawerTitle>
          ) : null}
          {children}
        </ResponsiveDrawerDepthContext.Provider>
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// PersistentResponsiveDrawerShell: a bottom drawer for a large, persistent
// panel. Unlike Radix/Vaul, this shell does not apply modal attributes to the
// app root. Those attributes make WebKit resolve styles for the full chat tree
// on each open. The backdrop blocks pointer input, while the key handler keeps
// keyboard focus inside the drawer.
// ---------------------------------------------------------------------------

interface PersistentResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  srLabel: string;
  contentClassName?: string;
  motionDurationMs?: number;
  onContentAnimationEnd?: (open: boolean) => void;
  children: React.ReactNode;
}

const PERSISTENT_DRAWER_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const PERSISTENT_DRAWER_CLOSE_RATIO = 0.25;
const PERSISTENT_DRAWER_CLOSE_VELOCITY_PX_PER_SEC = 450;
const PERSISTENT_DRAWER_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type PersistentDrawerDrag = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTimeMs: number;
  velocityY: number;
  height: number;
};

export function PersistentResponsiveDrawerShell({
  open,
  onOpenChange,
  srLabel,
  contentClassName,
  motionDurationMs = 220,
  onContentAnimationEnd,
  children,
}: PersistentResponsiveDrawerShellProps) {
  const parentDrawerDepth = React.useContext(ResponsiveDrawerDepthContext);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<PersistentDrawerDrag | null>(null);
  const settledStateRef = React.useRef<boolean | null>(null);
  const labelId = React.useId();
  const isPointerCoarse = usePointerCoarse();
  const portalScopeProps = usePortalScopeProps();
  const transition = `transform ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const backdropTransition = `opacity ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const requestClose = React.useCallback(() => {
    blurActiveKeyboardInputWithin(panelRef.current);
    resetDrawerKeyboardStyles(panelRef.current);
    onOpenChangeRef.current(false);
  }, []);

  const reportSettled = React.useCallback(
    (settledOpen: boolean) => {
      if (settledStateRef.current === settledOpen) {
        return;
      }
      settledStateRef.current = settledOpen;
      onContentAnimationEnd?.(settledOpen);
    },
    [onContentAnimationEnd],
  );

  React.useEffect(() => {
    settledStateRef.current = null;
    const timeout = window.setTimeout(
      () => reportSettled(open),
      motionDurationMs + 50,
    );
    return () => window.clearTimeout(timeout);
  }, [motionDurationMs, open, reportSettled]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const activeElement = panel.ownerDocument.activeElement;
      if (
        activeElement !== panel.ownerDocument.body &&
        !panel.contains(activeElement)
      ) {
        return;
      }
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          PERSISTENT_DRAWER_FOCUSABLE_SELECTOR,
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (activeElement === first ||
          activeElement === panel ||
          activeElement === panel.ownerDocument.body)
      ) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (activeElement === last || activeElement === panel.ownerDocument.body)
      ) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    let focusFrame: number | null = null;
    if (!isPointerCoarse) {
      focusFrame = window.requestAnimationFrame(() => {
        panelRef.current?.focus({ preventScroll: true });
      });
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (focusFrame !== null) {
        window.cancelAnimationFrame(focusFrame);
      }
    };
  }, [isPointerCoarse, open, requestClose]);

  const previousOpenRef = React.useRef(open);
  React.useLayoutEffect(() => {
    if (previousOpenRef.current && !open) {
      blurActiveKeyboardInputWithin(panelRef.current);
      resetDrawerKeyboardStyles(panelRef.current);
    }
    previousOpenRef.current = open;
  }, [open]);

  const setDragPosition = React.useCallback(
    (offsetY: number, height: number, animate: boolean) => {
      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      if (panel === null || backdrop === null) {
        return;
      }
      panel.style.transition = animate ? transition : "none";
      panel.style.transform = `translate3d(0, ${offsetY}px, 0)`;
      backdrop.style.transition = animate ? backdropTransition : "none";
      backdrop.style.opacity = String(
        Math.max(0, Math.min(1, 1 - offsetY / height)),
      );
    },
    [backdropTransition, transition],
  );

  const handleDragStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!open || event.button !== 0) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const nowMs = Date.now();
      const height = Math.max(panelRef.current?.clientHeight ?? 0, 1);
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastTimeMs: nowMs,
        velocityY: 0,
        height,
      };
      setDragPosition(0, height, false);
      event.preventDefault();
    },
    [open, setDragPosition],
  );

  const handleDragMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      const nowMs = Date.now();
      const elapsedMs = nowMs - drag.lastTimeMs;
      if (elapsedMs > 0) {
        drag.velocityY = ((event.clientY - drag.lastY) / elapsedMs) * 1000;
        drag.lastY = event.clientY;
        drag.lastTimeMs = nowMs;
      }
      setDragPosition(
        Math.max(0, event.clientY - drag.startY),
        drag.height,
        false,
      );
      event.preventDefault();
    },
    [setDragPosition],
  );

  const finishDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      const offsetY = Math.max(0, event.clientY - drag.startY);
      const shouldClose =
        !cancelled &&
        (offsetY >= drag.height * PERSISTENT_DRAWER_CLOSE_RATIO ||
          drag.velocityY >= PERSISTENT_DRAWER_CLOSE_VELOCITY_PX_PER_SEC);
      if (shouldClose) {
        setDragPosition(drag.height, drag.height, true);
        requestClose();
      } else {
        setDragPosition(0, drag.height, true);
      }
      event.preventDefault();
    },
    [requestClose, setDragPosition],
  );

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (portalTarget === null) {
    return null;
  }

  return createPortal(
    <>
      <div
        ref={backdropRef}
        {...portalScopeProps}
        aria-hidden="true"
        data-persistent-drawer-backdrop=""
        data-state={open ? "open" : "closed"}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: backdropTransition,
        }}
        onClick={requestClose}
        onTouchMove={(event) => event.preventDefault()}
      />
      <div
        ref={panelRef}
        {...portalScopeProps}
        aria-hidden={!open}
        aria-labelledby={labelId}
        aria-modal={open || undefined}
        data-persistent-drawer-content=""
        data-state={open ? "open" : "closed"}
        inert={!open}
        role="dialog"
        tabIndex={-1}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92dvh] flex-col rounded-t-xl border bg-background outline-none",
          contentClassName,
        )}
        style={{
          transform: open ? "translate3d(0, 0, 0)" : "translate3d(0, 100%, 0)",
          transition,
          willChange: "transform",
        }}
        onTransitionEnd={(event) => {
          if (
            event.currentTarget === event.target &&
            event.propertyName === "transform"
          ) {
            reportSettled(open);
          }
        }}
      >
        <div
          data-persistent-drawer-handle=""
          className="mx-auto flex h-8 w-16 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={(event) => finishDrag(event, false)}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        <h2 id={labelId} className="sr-only">
          {srLabel}
        </h2>
        <ResponsiveDrawerDepthContext.Provider value={parentDrawerDepth + 1}>
          {children}
        </ResponsiveDrawerDepthContext.Provider>
      </div>
    </>,
    portalTarget,
  );
}
