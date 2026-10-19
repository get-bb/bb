import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePersistentOverlayFocus } from "@bb/shared-ui/responsive-overlay";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import { hasTextSelectionWithin } from "@/components/ui/gesture-dom";
import { useHorizontalDismissDrag } from "@/components/ui/use-horizontal-dismiss-drag";
import {
  setCompactSecondaryPanelPresentation,
  setCompactSecondaryPanelSwipeOpening,
} from "@/components/ui/secondary-panel-shelf-visibility";
import { isCompactSidebarDrawerShowing } from "@/components/ui/sidebar-mobile-drawer-visibility";

const SHELF_TRANSITION_CLASS =
  "[transition:translate_220ms_cubic-bezier(0.32,0.72,0,1),width_220ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none!";
const SHELF_SETTLE_MS = 220;
const SHELF_DRAG_SETTLE_TRANSITION =
  "translate 220ms cubic-bezier(0.32, 0.72, 0, 1)";

interface CompactSecondaryPanelShelfProps {
  children: ReactNode;
  onClose: () => void;
  onContentAnimationEnd?: (open: boolean) => void;
  onOpen?: () => void;
  open: boolean;
  srLabel: string;
}

export function CompactSecondaryPanelShelf({
  children,
  onClose,
  onContentAnimationEnd,
  onOpen,
  open,
  srLabel,
}: CompactSecondaryPanelShelfProps) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const draggedInsetRef = useRef<HTMLElement | null>(null);
  const state = open ? "full" : "closed";
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const requestClose = useCallback(() => onCloseRef.current(), []);
  const onOpenRef = useRef(onOpen);
  useLayoutEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const openDraggedInsetRef = useRef<HTMLElement | null>(null);
  const canSwipeOpen = onOpen !== undefined && !open;

  const clearDragStyles = useCallback(() => {
    const inset = draggedInsetRef.current;
    if (inset !== null) {
      inset.style.translate = "";
      inset.style.transition = "";
      draggedInsetRef.current = null;
    }
  }, []);

  const applyDragProgress = useCallback(
    ({
      progress,
      width,
      settling,
    }: {
      progress: number;
      width: number;
      settling: boolean;
    }) => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const inset = panel.ownerDocument.querySelector('[data-sidebar="inset"]');
      if (inset instanceof HTMLElement) {
        draggedInsetRef.current = inset;
        inset.style.translate = `${-width * progress}px`;
        inset.style.transition = settling
          ? SHELF_DRAG_SETTLE_TRANSITION
          : "none";
      }
    },
    [],
  );
  const { beginPointerDrag, beginTouchDrag } = useHorizontalDismissDrag({
    direction: "right",
    dismissTiming: "immediate",
    enabled: open,
    getWidth: () => panelRef.current?.clientWidth ?? 0,
    onClear: clearDragStyles,
    onDismiss: requestClose,
    onProgress: applyDragProgress,
    resetKey: state,
    shouldBeginDrag: () => true,
    suppressClick: false,
  });

  const clearOpenDragStyles = useCallback(() => {
    setCompactSecondaryPanelSwipeOpening(false);
    const inset = openDraggedInsetRef.current;
    if (inset === null) {
      return;
    }
    inset.style.translate = "";
    inset.style.transition = "";
    openDraggedInsetRef.current = null;
    const panel = panelRef.current;
    if (panel !== null) {
      panel.style.visibility = "";
      panel.style.width = "";
      panel.style.transition = "";
    }
  }, []);

  const applyOpenDragProgress = useCallback(
    ({
      progress,
      width,
      settling,
    }: {
      progress: number;
      width: number;
      settling: boolean;
    }) => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const inset = panel.ownerDocument.querySelector('[data-sidebar="inset"]');
      if (!(inset instanceof HTMLElement)) {
        return;
      }
      openDraggedInsetRef.current = inset;
      setCompactSecondaryPanelSwipeOpening(true);
      inset.style.translate = `${-width * (1 - progress)}px`;
      inset.style.transition = settling ? SHELF_DRAG_SETTLE_TRANSITION : "none";
      panel.style.visibility = "visible";
      panel.style.width = "100%";
      panel.style.transition = "none";
    },
    [],
  );

  const canBeginOpenDrag = useCallback(() => {
    const inset = panelRef.current?.ownerDocument.querySelector(
      '[data-sidebar="inset"]',
    );
    return (
      !isCompactSidebarDrawerShowing() &&
      inset?.getAttribute("data-sidebar-shelf") !== "open"
    );
  }, []);

  const requestOpen = useCallback(() => {
    flushSync(() => onOpenRef.current?.());
    clearOpenDragStyles();
  }, [clearOpenDragStyles]);

  const {
    beginNativePointerDrag: beginOpenPointerDrag,
    beginNativeTouchDrag: beginOpenTouchDrag,
  } = useHorizontalDismissDrag({
    direction: "left",
    dismissTiming: "settled",
    enabled: canSwipeOpen,
    getWidth: () =>
      panelRef.current?.ownerDocument.documentElement.clientWidth ?? 0,
    onClear: clearOpenDragStyles,
    onDismiss: requestOpen,
    onProgress: applyOpenDragProgress,
    resetKey: state,
    shouldBeginDrag: canBeginOpenDrag,
    suppressClick: true,
  });

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!canSwipeOpen || portalTarget === null) {
      return;
    }
    const inset = portalTarget.ownerDocument.querySelector(
      '[data-sidebar="inset"]',
    );
    if (!(inset instanceof HTMLElement)) {
      return;
    }
    const startPointer = (event: PointerEvent) => {
      if (!isCompactSidebarDrawerShowing()) {
        beginOpenPointerDrag(event, inset);
      }
    };
    const startTouch = (event: TouchEvent) => {
      if (!isCompactSidebarDrawerShowing()) {
        beginOpenTouchDrag(event, inset);
      }
    };
    inset.addEventListener("pointerdown", startPointer, { passive: true });
    inset.addEventListener("touchstart", startTouch, { passive: true });
    return () => {
      inset.removeEventListener("pointerdown", startPointer);
      inset.removeEventListener("touchstart", startTouch);
    };
  }, [beginOpenPointerDrag, beginOpenTouchDrag, canSwipeOpen, portalTarget]);

  usePersistentOverlayFocus({
    open: open && portalTarget !== null,
    panelRef,
    requestClose,
  });

  useLayoutEffect(() => {
    if (open) return;
    const panel = panelRef.current;
    if (panel === null) return;
    if (hasTextSelectionWithin(panel)) {
      panel.ownerDocument.getSelection()?.removeAllRanges();
    }
  }, [open]);

  useEffect(() => {
    setCompactSecondaryPanelPresentation(state);
    return () => setCompactSecondaryPanelPresentation("closed");
  }, [state]);

  useEffect(() => {
    if (onContentAnimationEnd === undefined) return;
    const timer = window.setTimeout(
      () => onContentAnimationEnd(open),
      SHELF_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [onContentAnimationEnd, open]);

  if (portalTarget === null) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      data-bb-portaled-overlay=""
      tabIndex={-1}
      inert={!open}
      data-testid="secondary-panel-shelf"
      data-state={state}
      style={{
        zIndex:
          state === "full"
            ? APP_OVERLAY_LAYER.secondaryPanelFullPage
            : APP_OVERLAY_LAYER.secondaryPanel,
      }}
      className={cn(
        "fixed inset-y-0 right-0 flex h-(--bb-shell-height) flex-col overflow-hidden border-l border-border-seam bg-sidebar pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] outline-none",
        "w-(--secondary-panel-width-mobile) data-[state=full]:w-full data-[state=full]:border-l-0",
        SHELF_TRANSITION_CLASS,
        "data-[state=closed]:invisible data-[state=closed]:[transition:visibility_0s_linear_220ms]",
      )}
      onPointerDown={beginPointerDrag}
      onTouchStart={beginTouchDrag}
    >
      <span id={labelId} className="sr-only">
        {srLabel}
      </span>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>,
    portalTarget,
  );
}
