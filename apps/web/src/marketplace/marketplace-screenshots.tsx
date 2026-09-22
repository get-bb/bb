import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

import { marketplaceAssetUrl } from "./marketplace-view-model.js";

export function MarketplaceScreenshots({
  screenshots,
  name,
}: {
  screenshots: readonly string[];
  name: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = selected !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [zoomed, selected]);

  const move = (delta: number) => {
    setZoomed(false);
    setSelected((index) =>
      index === null
        ? null
        : (index + delta + screenshots.length) % screenshots.length,
    );
  };

  return (
    <>
      <div className="marketplace-screenshots">
        {screenshots.map((screenshot, index) => (
          <button
            key={screenshot}
            type="button"
            className="marketplace-screenshot-trigger"
            aria-label={`Enlarge ${name} screenshot ${index + 1}`}
            aria-haspopup="dialog"
            onClick={() => {
              setZoomed(false);
              setSelected(index);
            }}
          >
            <img
              src={marketplaceAssetUrl(screenshot)}
              alt={`${name} screenshot ${index + 1}`}
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      <dialog
        ref={dialogRef}
        className="marketplace-lightbox"
        aria-label={`${name} screenshots`}
        onClose={() => setSelected(null)}
        onCancel={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
        onKeyDown={(event) => {
          if (
            !zoomed &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {selected === null ? null : (
          <>
            <div className="marketplace-lightbox-toolbar">
              <div className="marketplace-lightbox-navigation">
                {screenshots.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Previous screenshot"
                    onClick={() => move(-1)}
                  >
                    <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
                  </button>
                ) : null}
                <span aria-live="polite">
                  {selected + 1} / {screenshots.length}
                </span>
                {screenshots.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Next screenshot"
                    onClick={() => move(1)}
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="marketplace-lightbox-tools">
                <button
                  type="button"
                  className="marketplace-lightbox-zoom"
                  aria-pressed={zoomed}
                  onClick={() => setZoomed(!zoomed)}
                >
                  {zoomed ? "Fit image" : "Original size"}
                </button>
                <button
                  type="button"
                  aria-label="Close screenshots"
                  onClick={() => setSelected(null)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                </button>
              </div>
            </div>
            <div
              ref={viewportRef}
              className={`marketplace-lightbox-viewport${zoomed ? " is-zoomed" : ""}`}
              tabIndex={zoomed ? 0 : undefined}
              role="region"
              aria-label={
                zoomed
                  ? "Original size screenshot. Scroll or drag to explore."
                  : "Screenshot"
              }
              onClick={(event) => {
                if (!zoomed && event.target === event.currentTarget)
                  setSelected(null);
              }}
              onPointerDown={(event) => {
                if (
                  !zoomed ||
                  event.pointerType !== "mouse" ||
                  event.button !== 0
                )
                  return;
                const viewport = event.currentTarget;
                dragRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: viewport.scrollLeft,
                  top: viewport.scrollTop,
                };
                viewport.setPointerCapture(event.pointerId);
                viewport.focus();
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                event.currentTarget.scrollLeft =
                  drag.left - (event.clientX - drag.x);
                event.currentTarget.scrollTop =
                  drag.top - (event.clientY - drag.y);
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              onLostPointerCapture={() => {
                dragRef.current = null;
              }}
            >
              <img
                src={marketplaceAssetUrl(screenshots[selected])}
                alt={`${name} screenshot ${selected + 1}`}
                referrerPolicy="no-referrer"
                draggable={false}
              />
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
