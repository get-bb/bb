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

const LONG_PRESS_MS = 700;
const LONG_PRESS_MOVE_SLOP_PX = 10;

const LONG_PRESS_TARGET_STYLE: CSSProperties = {
  WebkitTouchCallout: "none",
};

const claimedPressEvents = new WeakSet<Event>();

interface CompactLongPressMenuProps {
  children: ReactNode;
  disabled?: boolean;
  items: ReactNode;
  label: string;
  onOpenChange?: (open: boolean) => void;
}

export function CompactLongPressMenu({
  children,
  disabled = false,
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
  const suppressClickRef = useRef(false);

  const clearPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pressRef.current = null;
  }, []);

  useEffect(() => clearPress, [clearPress]);

  useEffect(() => {
    if (disabled) {
      clearPress();
      suppressClickRef.current = false;
    }
  }, [clearPress, disabled]);

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
      suppressClickRef.current = false;
      if (disabled) {
        return;
      }
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
        suppressClickRef.current = true;
        openMenu();
      }, LONG_PRESS_MS);
    },
    [clearPress, disabled, openMenu],
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
      if (disabled || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (pressRef.current !== null) {
        suppressClickRef.current = true;
      }
      openMenu();
    },
    [disabled, openMenu],
  );

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!suppressClickRef.current) {
        return;
      }
      suppressClickRef.current = false;
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
        onKeyDownCapture={() => {
          suppressClickRef.current = false;
        }}
      >
        {children}
      </Slot>
      {hasOpened ? (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
          <DropdownMenuContent
            mobileTitle={label}
            aria-label={label}
            onPointerDownCapture={() => {
              suppressClickRef.current = false;
            }}
            onClickCapture={handleClickCapture}
            onKeyDownCapture={() => {
              suppressClickRef.current = false;
            }}
          >
            {items}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
