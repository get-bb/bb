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

  const move = (delta: number) => {
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
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
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
                  aria-label="Close screenshots"
                  onClick={() => setSelected(null)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                </button>
              </div>
            </div>
            <div
              className="marketplace-lightbox-viewport"
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelected(null);
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
