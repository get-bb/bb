import * as React from "react";
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
  const handleContentAnimationEnd =
    React.useCallback<React.AnimationEventHandler<HTMLDivElement>>(
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
