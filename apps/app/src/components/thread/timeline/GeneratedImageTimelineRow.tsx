import { useRef, useState } from "react";
import type { TimelineGeneratedImageRow } from "@bb/server-contract";
import { fileNameFromPath } from "@bb/thread-view";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ImageLightbox } from "../../ui/image-lightbox.js";
import { buildThreadGeneratedImageContentUrl } from "@/lib/file-content-urls";

interface GeneratedImageTimelineRowProps {
  row: TimelineGeneratedImageRow;
}

type GeneratedImageLoadState = "loading" | "loaded" | "error";

export function GeneratedImageTimelineRow({
  row,
}: GeneratedImageTimelineRowProps) {
  const previewRef = useRef<HTMLButtonElement>(null);
  const [loadState, setLoadState] =
    useState<GeneratedImageLoadState>("loading");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imageSrc = buildThreadGeneratedImageContentUrl(
    row.threadId,
    row.sourceSeqStart,
  );
  const imageName = fileNameFromPath(row.path);
  const imageAlt = `Generated image: ${imageName}`;

  if (loadState === "error") {
    return (
      <EmptyStatePanel className="max-w-80 rounded-lg sm:max-w-96">
        <div>Generated image unavailable.</div>
        <div className="mt-1 break-all font-mono text-xs">{row.path}</div>
      </EmptyStatePanel>
    );
  }

  return (
    <>
      <button
        ref={previewRef}
        type="button"
        className="block aspect-square w-full max-w-80 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-96"
        onClick={() => setLightboxOpen(true)}
        aria-busy={loadState === "loading"}
        aria-label={`Open generated image preview: ${imageName}`}
      >
        <img
          src={imageSrc}
          alt=""
          className={`block h-auto w-full object-contain ${loadState === "loading" ? "opacity-0" : "opacity-100"}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadState("loaded")}
          onError={() => setLoadState("error")}
        />
      </button>
      <ImageLightbox
        imageAlt={imageAlt}
        imageSrc={lightboxOpen ? imageSrc : null}
        onClose={() => setLightboxOpen(false)}
        returnFocusRef={previewRef}
        title={imageAlt}
      />
    </>
  );
}
