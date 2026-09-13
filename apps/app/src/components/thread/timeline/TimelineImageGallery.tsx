import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { InlineImageGalleryContext } from "@/components/ui/inline-image-gallery-context";

interface GalleryImage {
  key: string;
  src: string;
  alt: string;
}

interface GalleryState {
  images: GalleryImage[];
  index: number;
}

function isEligible(image: HTMLImageElement): boolean {
  if (image.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  const clipped = image.closest("[data-image-gallery-clipped]");
  if (clipped) {
    const bounds = clipped.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    return imageBounds.top >= bounds.top && imageBounds.bottom <= bounds.bottom;
  }
  return true;
}

function reconcileGallery(
  current: GalleryState,
  eligible: GalleryImage[],
): GalleryState {
  const selected = current.images[current.index];
  const images = eligible.slice();
  let index = images.findIndex((image) => image.key === selected.key);
  if (index < 0) {
    const positions = new Map(images.map((image, position) => [image.key, position]));
    index = Math.min(current.index, images.length);
    for (const image of current.images.slice(current.index + 1)) {
      const position = positions.get(image.key);
      if (position !== undefined) {
        index = position;
        break;
      }
    }
    images.splice(index, 0, selected);
  } else {
    images[index] = selected;
  }
  if (
    index === current.index &&
    images.length === current.images.length &&
    images.every((image, position) => {
      const previous = current.images[position];
      return image.key === previous.key && image.src === previous.src && image.alt === previous.alt;
    })
  ) return current;
  return { images, index };
}

export function TimelineImageGallery({ children }: { children: ReactNode }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [gallery, setGallery] = useState<GalleryState | null>(null);
  const open = gallery !== null;
  const collectImages = useCallback(() => {
    const images = new Map<HTMLImageElement, GalleryImage>();
    const occurrences = new Map<string, number>();
    for (const image of timelineRef.current?.querySelectorAll<HTMLImageElement>(
      "img[data-markdown-image]",
    ) ?? []) {
      const identity = JSON.stringify([
        image.closest("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id"),
        image.getAttribute("data-markdown-image-offset") ?? [
          image.getAttribute("src"), image.alt,
        ],
      ]);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      if (isEligible(image)) {
        images.set(image, {
          key: `${identity}:${occurrence}`,
          src: image.currentSrc || image.src,
          alt: image.alt,
        });
      }
    }
    return images;
  }, []);
  const openImage = useCallback(
    (selected: HTMLImageElement) => {
      const collection = collectImages();
      const image = collection.get(selected);
      if (!image) return;
      const images = Array.from(collection.values());
      setGallery({ images, index: images.indexOf(image) });
    },
    [collectImages],
  );

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!open || !timeline) return;
    let frame: number | null = null;
    const refresh = () => {
      const images = Array.from(collectImages().values());
      setGallery((current) => current && reconcileGallery(current, images));
    };
    const scheduleRefresh = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        refresh();
      });
    };
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(timeline, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "src", "srcset", "alt", "hidden", "inert", "aria-hidden",
        "data-image-gallery-clipped", "data-timeline-row-id",
        "data-markdown-image-offset",
      ],
    });
    timeline.addEventListener("load", scheduleRefresh, true);
    window.addEventListener("resize", scheduleRefresh);
    refresh();
    return () => {
      observer.disconnect();
      timeline.removeEventListener("load", scheduleRefresh, true);
      window.removeEventListener("resize", scheduleRefresh);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [collectImages, open]);

  const navigate = (direction: "previous" | "next") => {
    const images = Array.from(collectImages().values());
    setGallery((current) => {
      if (current === null) return null;
      const updated = reconcileGallery(current, images);
      return reconcileGallery({
        images: updated.images,
        index: Math.max(
          0,
          Math.min(
            updated.images.length - 1,
            updated.index + (direction === "previous" ? -1 : 1),
          ),
        ),
      }, images);
    });
  };
  const selected = gallery?.images[gallery.index];
  return (
    <InlineImageGalleryContext.Provider value={openImage}>
      <div ref={timelineRef} className="contents">
        {children}
      </div>
      <ImageLightbox
        imageSrc={selected?.src ?? null}
        imageAlt={selected?.alt ?? "Image"}
        title="Timeline image preview"
        hasMultipleImages={gallery !== null && gallery.images.length > 1}
        previousDisabled={gallery?.index === 0}
        nextDisabled={gallery !== null && gallery.index === gallery.images.length - 1}
        navigationStatus={
          gallery && gallery.images.length > 1
            ? `${gallery.index + 1} / ${gallery.images.length}`
            : undefined
        }
        onClose={() => setGallery(null)}
        onPrevious={() => navigate("previous")}
        onNext={() => navigate("next")}
      />
    </InlineImageGalleryContext.Provider>
  );
}
