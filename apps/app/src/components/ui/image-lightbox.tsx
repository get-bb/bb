import { useEffect, type CSSProperties } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@bb/shared-ui/dialog";
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

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        hideCloseButton
        className="left-0 top-0 flex h-[calc(92svh-var(--bb-drawer-keyboard-inset,0px)-2.125rem)] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col items-center gap-3 overflow-hidden border-0 bg-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-none duration-0 data-[state=closed]:animate-none data-[state=open]:animate-none sm:h-full sm:rounded-none sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div
          className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          {imageSrc ? (
            <div
              className="absolute inset-0 flex items-center justify-center"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  onClose();
                }
              }}
            >
              <img
                src={imageSrc}
                alt={imageAlt}
                style={IMAGE_TRANSPARENCY_CHECKER_STYLE}
                className="max-h-full max-w-[90vw] rounded object-contain"
              />
            </div>
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
        </div>

        {hasNavigation ? (
          <div className="shrink-0 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white/80 shadow-sm backdrop-blur-sm pointer-coarse:hidden">
            ← → to navigate
          </div>
        ) : null}

        {hasNavigation ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pointer-coarse:hidden absolute left-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
              onClick={onPrevious}
              aria-label="Previous image"
            >
              <Icon name="ChevronLeft" className="size-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pointer-coarse:hidden absolute right-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
              onClick={onNext}
              aria-label="Next image"
            >
              <Icon name="ChevronRight" className="size-5" />
            </Button>
          </>
        ) : null}

        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 size-9 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
            aria-label="Close image preview"
          >
            <Icon name="X" className="size-5" />
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
