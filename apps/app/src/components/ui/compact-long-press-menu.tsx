import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { DropdownMenu, DropdownMenuContent } from "@bb/shared-ui/dropdown-menu";

// Matches Radix ContextMenu's touch long-press delay so the gesture feels the
// same as before; the slop lets a finger settle without cancelling.
const LONG_PRESS_MS = 700;
const LONG_PRESS_MOVE_SLOP_PX = 10;
// A long press that opens the menu ends with the finger lifting, and the
// browser may still synthesize a click on the row underneath. Swallow that
// click for a short window so the row does not also navigate.
const POST_LONG_PRESS_CLICK_SUPPRESSION_MS = 1000;

const LONG_PRESS_TARGET_STYLE: CSSProperties = {
  // Stop iOS from showing its own link callout for the long press.
  WebkitTouchCallout: "none",
};

// These menus nest (a project section wraps its thread rows), and pointer
// events bubble from the row to the section. The innermost menu handles the
// press first and claims the native event here so an enclosing menu does not
// start its own timer and open a second drawer 700 ms later.
const claimedPressEvents = new WeakSet<Event>();

interface CompactLongPressMenuProps {
  /** The single element that receives the long-press gesture (a row). */
  children: ReactNode;
  /** Menu items rendered inside the compact drawer; mounted on first open. */
  items: ReactNode;
  /** Screen-reader label for the drawer surface. */
  label: string;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Compact-viewport replacement for a row's right-click `ContextMenu`.
 *
 * On phones the sidebar rows previously mounted a Radix `ContextMenu` root per
 * row, whose long-press opened a MODAL Radix menu: `hideOthers` set
 * `aria-hidden` on `#root`, RemoveScroll registered a non-passive `touchmove`,
 * and `body.style.pointerEvents = "none"` invalidated the whole document with
 * the full timeline mounted behind the drawer. This component keeps the same
 * gesture (700 ms touch long-press, or right-click on a narrow desktop window)
 * but opens the app's persistent responsive drawer instead, through the same
 * `DropdownMenu` items the row's "..." button uses. Nothing is mounted for the
 * menu until the first open, so a hundred rows cost a few pointer handlers.
 */
export function CompactLongPressMenu({
  children,
  items,
  label,
  onOpenChange,
}: CompactLongPressMenuProps) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pressRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const suppressClickUntilRef = useRef(0);

  const clearPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pressRef.current = null;
  }, []);

  useEffect(() => clearPress, [clearPress]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const openMenu = useCallback(() => {
    clearPress();
    setHasOpened(true);
    handleOpenChange(true);
  }, [clearPress, handleOpenChange]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }
      if (!event.isPrimary) {
        return;
      }
      if (claimedPressEvents.has(event.nativeEvent)) {
        return;
      }
      claimedPressEvents.add(event.nativeEvent);
      clearPress();
      pressRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (pressRef.current === null) {
          return;
        }
        pressRef.current = null;
        suppressClickUntilRef.current =
          Date.now() + POST_LONG_PRESS_CLICK_SUPPRESSION_MS;
        openMenu();
      }, LONG_PRESS_MS);
    },
    [clearPress, openMenu],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressRef.current;
      if (press === null || press.pointerId !== event.pointerId) {
        return;
      }
      if (
        Math.abs(event.clientX - press.x) > LONG_PRESS_MOVE_SLOP_PX ||
        Math.abs(event.clientY - press.y) > LONG_PRESS_MOVE_SLOP_PX
      ) {
        clearPress();
      }
    },
    [clearPress],
  );

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pressRef.current?.pointerId === event.pointerId) {
        clearPress();
      }
    },
    [clearPress],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      // An enclosed menu (or another handler) already took this one; the same
      // rule Radix's ContextMenuTrigger applies through defaultPrevented.
      if (event.defaultPrevented) {
        return;
      }
      // Right-click (or a browser-synthesized contextmenu after a long
      // press) opens the same drawer and must not show the native menu.
      event.preventDefault();
      if (pressRef.current !== null) {
        // Chrome Android fires contextmenu from the long press before our own
        // timer; the lift that follows must not also activate the row.
        suppressClickUntilRef.current =
          Date.now() + POST_LONG_PRESS_CLICK_SUPPRESSION_MS;
      }
      openMenu();
    },
    [openMenu],
  );

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (Date.now() >= suppressClickUntilRef.current) {
        return;
      }
      suppressClickUntilRef.current = 0;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return (
    <>
      <Slot
        style={LONG_PRESS_TARGET_STYLE}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={handleContextMenu}
        onClickCapture={handleClickCapture}
      >
        {children}
      </Slot>
      {hasOpened ? (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
          <DropdownMenuContent mobileTitle={label} aria-label={label}>
            {items}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
