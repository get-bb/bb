import { useEffect, useId, useState } from "react";

export function LightboxImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={className ? `lightbox-trigger ${className}` : "lightbox-trigger"}
        onClick={() => setOpen(true)}
      >
        <img src={src} alt={alt} />
      </button>
      {open ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          onClick={() => setOpen(false)}
        >
          <span id={labelId} className="sr-only">
            {alt || "Image"}
          </span>
          <img src={src} alt={alt} />
        </div>
      ) : null}
    </>
  );
}
