import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@bb/shared-ui/button";
import { usePersistentOverlayFocus } from "@bb/shared-ui/responsive-overlay";
import { usePortalScopeProps } from "@bb/shared-ui/lib/portal-scope";
import { useBrowserDimmingOverlay } from "@/hooks/useBrowserDimmingModal";
import { Icon } from "@bb/shared-ui/icon";

type ImageLightboxKeyAction = "close" | "next" | "previous";

const IMAGE_TRANSPARENCY_CHECKER_BASE =
  "color-mix(in oklch, var(--ink) 5%, var(--canvas))";
const IMAGE_TRANSPARENCY_CHECKER_MARK =
  "color-mix(in oklch, var(--ink) 14%, var(--canvas))";

export const IMAGE_TRANSPARENCY_CHECKER_STYLE: CSSProperties = {
  backgroundColor: IMAGE_TRANSPARENCY_CHECKER_BASE,
  backgroundImage: `conic-gradient(${IMAGE_TRANSPARENCY_CHECKER_MARK} 25%, ${IMAGE_TRANSPARENCY_CHECKER_BASE} 0 50%, ${IMAGE_TRANSPARENCY_CHECKER_MARK} 0 75%, ${IMAGE_TRANSPARENCY_CHECKER_BASE} 0)`,
  backgroundSize: "16px 16px",
};

interface ImageLightboxKeyActionInput {
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey"
  >;
  hasNavigation: boolean;
}

interface WrappedImageIndexInput {
  currentIndex: number;
  direction: "next" | "previous";
  itemCount: number;
}

interface ImageLightboxProps {
  hasMultipleImages?: boolean;
  imageAlt: string;
  imageSrc: string | null;
  isOpen?: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  title: string;
}

export function getImageLightboxKeyAction({
  event,
  hasNavigation,
}: ImageLightboxKeyActionInput): ImageLightboxKeyAction | null {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }

  if (event.key === "Escape") {
    return "close";
  }

  if (!hasNavigation) {
    return null;
  }

  if (event.key === "ArrowLeft") {
    return "previous";
  }

  if (event.key === "ArrowRight") {
    return "next";
  }

  return null;
}

export function getWrappedImageIndex({
  currentIndex,
  direction,
  itemCount,
}: WrappedImageIndexInput): number {
  if (itemCount <= 0) {
    return currentIndex;
  }
  if (direction === "previous") {
    return currentIndex === 0 ? itemCount - 1 : currentIndex - 1;
  }
  return currentIndex === itemCount - 1 ? 0 : currentIndex + 1;
}

export function ImageLightbox({
  hasMultipleImages = false,
  imageAlt,
  imageSrc,
  isOpen,
  onClose,
  onNext,
  onPrevious,
  title,
}: ImageLightboxProps) {
  const isVisible = isOpen ?? imageSrc !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const requestClose = useCallback(() => closeRef.current(), []);
  const titleId = useId();
  const scopeProps = usePortalScopeProps();
  useBrowserDimmingOverlay(isVisible);
  usePersistentOverlayFocus({
    open: isVisible,
    panelRef,
    requestClose,
  });
  const hasNavigation =
    hasMultipleImages && onPrevious !== undefined && onNext !== undefined;

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getImageLightboxKeyAction({
        event,
        hasNavigation,
      });
      if (!action) {
        return;
      }

      switch (action) {
        case "close":
          event.preventDefault();
          onClose();
          return;
        case "previous":
          if (!onPrevious) {
            return;
          }
          event.preventDefault();
          onPrevious();
          return;
        case "next":
          if (!onNext) {
            return;
          }
          event.preventDefault();
          onNext();
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasNavigation, isVisible, onClose, onNext, onPrevious]);

  if (!isVisible) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      {...scopeProps}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex h-dvh w-full cursor-zoom-out items-center justify-center bg-black/70 p-4 outline-none animate-in fade-in-0 duration-150 motion-reduce:animate-none"
      onClick={(event) => {
        if (
          event.target === event.currentTarget ||
          event.target instanceof HTMLImageElement
        ) {
          onClose();
        }
      }}
    >
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={imageAlt}
          style={IMAGE_TRANSPARENCY_CHECKER_STYLE}
          className="max-h-[82dvh] max-w-full object-contain"
        />
      ) : (
        <div
          role="status"
          aria-label="Loading image"
          className="flex size-32 flex-col items-center justify-center gap-2 rounded-xl bg-black/35 text-sm text-white/60 sm:size-48"
        >
          <Icon name="Loading" className="size-5 animate-spin" />
          <span>Loading image…</span>
        </div>
      )}

      {hasNavigation ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute left-[max(0.5rem,env(safe-area-inset-left))] top-1/2 size-11 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
            onClick={onPrevious}
            aria-label="Previous image"
          >
            <Icon name="ChevronLeft" className="size-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-[max(0.5rem,env(safe-area-inset-right))] top-1/2 size-11 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
            onClick={onNext}
            aria-label="Next image"
          >
            <Icon name="ChevronRight" className="size-5" />
          </Button>
        </>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] size-11 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
        onClick={onClose}
        aria-label="Close image preview"
      >
        <Icon name="X" className="size-5" />
      </Button>
    </div>,
    document.body,
  );
}
