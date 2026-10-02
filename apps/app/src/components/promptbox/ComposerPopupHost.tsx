import { useEffect, type ReactNode, type RefObject } from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { cn } from "@bb/shared-ui/lib/utils";

interface ComposerPopupHostProps {
  open: boolean;
  placement: "top" | "bottom";
  label: string;
  interactive: boolean;
  popupRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLFormElement | null>;
  onClose(restoreFocus: boolean): void;
  children: ReactNode;
}

export function ComposerPopupHost(props: ComposerPopupHostProps) {
  const { open, label, interactive, popupRef, composerRef, onClose } = props;
  const compact = useIsCompactViewport();
  const drawer = interactive && compact;

  useEffect(() => {
    if (!open || drawer) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (popupRef.current?.contains(event.target)) return;
      if (composerRef.current?.contains(event.target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      document.removeEventListener("pointerdown", dismissOutside, true);
  }, [composerRef, drawer, onClose, open, popupRef]);

  const content = <ComposerPopupContent {...props} drawer={drawer} />;

  if (drawer) {
    return (
      <ResponsiveDrawerShell
        open={open}
        srLabel={label}
        onOpenChange={(next) => {
          if (!next) onClose(false);
        }}
        onAfterCloseAutoFocus={() => onClose(true)}
        contentClassName="p-0"
      >
        {content}
      </ResponsiveDrawerShell>
    );
  }
  return open ? content : null;
}

function ComposerPopupContent({
  open,
  drawer,
  placement,
  label,
  interactive,
  popupRef,
  children,
}: ComposerPopupHostProps & { drawer: boolean }) {
  useEffect(() => {
    if (!open || !interactive) return;
    const frame = window.requestAnimationFrame(() => {
      const firstInput = popupRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]',
      );
      firstInput?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interactive, open, popupRef]);
  return (
    <div
      ref={popupRef}
      data-promptbox-typeahead-menu=""
      role={interactive && !drawer ? "dialog" : undefined}
      aria-label={interactive ? label : undefined}
      className={
        drawer
          ? undefined
          : cn(
              "absolute -left-px -right-px z-20",
              placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
            )
      }
    >
      {children}
    </div>
  );
}
