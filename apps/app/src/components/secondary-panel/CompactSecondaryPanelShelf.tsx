import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { setCompactSecondaryPanelShelfShowing } from "@/components/ui/secondary-panel-shelf-visibility";

const SHELF_TRANSITION_CLASS =
  "[transition:translate_220ms_cubic-bezier(0.32,0.72,0,1)]";
const SHELF_SETTLE_MS = 220;

interface CompactSecondaryPanelShelfProps {
  children: ReactNode;
  onClose: () => void;
  onContentAnimationEnd?: (open: boolean) => void;
  open: boolean;
  srLabel?: string;
}

export function CompactSecondaryPanelShelf({
  children,
  onClose,
  onContentAnimationEnd,
  open,
  srLabel,
}: CompactSecondaryPanelShelfProps) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCompactSecondaryPanelShelfShowing(open);
    return () => setCompactSecondaryPanelShelfShowing(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (onContentAnimationEnd === undefined) return;
    const timer = window.setTimeout(
      () => onContentAnimationEnd(open),
      SHELF_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [onContentAnimationEnd, open]);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);
  if (portalTarget === null) {
    return null;
  }

  return createPortal(
    <>
      <div
        data-secondary-panel-shelf-dismiss=""
        data-testid="secondary-panel-shelf-dismiss"
        data-state={open ? "open" : "closed"}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-transparent",
          "data-[state=open]:-translate-x-(--secondary-panel-width-mobile)",
          SHELF_TRANSITION_CLASS,
          "data-[state=closed]:pointer-events-none",
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={srLabel === undefined ? undefined : labelId}
        tabIndex={-1}
        inert={!open}
        data-secondary-panel-shelf=""
        data-testid="secondary-panel-shelf"
        data-state={open ? "open" : "closed"}
        className={cn(
          "fixed inset-y-0 right-0 z-0 flex h-(--bb-shell-height) w-(--secondary-panel-width-mobile) select-none flex-col overflow-hidden border-l border-border-seam bg-background outline-none",
          "[transition:visibility_0s_linear_0s] data-[state=closed]:invisible data-[state=closed]:[transition:visibility_0s_linear_220ms]",
        )}
      >
        {srLabel === undefined ? null : (
          <span id={labelId} className="sr-only">
            {srLabel}
          </span>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </>,
    portalTarget,
  );
}
