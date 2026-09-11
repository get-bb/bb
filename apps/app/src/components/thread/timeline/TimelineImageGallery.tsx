import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ImageLightbox,
  getWrappedImageIndex,
} from "@/components/ui/image-lightbox";
import { InlineImageGalleryContext } from "@/components/ui/inline-image-gallery-context";

interface GalleryState {
  images: HTMLImageElement[];
  index: number;
}

export function TimelineImageGallery({ children }: { children: ReactNode }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [gallery, setGallery] = useState<GalleryState | null>(null);
  const collectImages = useCallback(
    () =>
      Array.from(
        timelineRef.current?.querySelectorAll<HTMLImageElement>(
          "img[data-markdown-image]",
        ) ?? [],
      ).filter(
        (image) =>
          image.closest('[aria-hidden="true"], [hidden], [inert]') === null,
      ),
    [],
  );
  const open = useCallback(
    (selected: HTMLImageElement) => {
      const images = collectImages();
      const index = images.indexOf(selected);
      if (index >= 0) setGallery({ images, index });
    },
    [collectImages],
  );
  const navigate = (direction: "previous" | "next") => {
    const images = collectImages();
    setGallery((current) => {
      if (current === null) return null;
      const index = images.indexOf(current.images[current.index]);
      if (index < 0) return null;
      return {
        images,
        index: getWrappedImageIndex({
          currentIndex: index,
          direction,
          itemCount: images.length,
        }),
      };
    });
  };
  const selected = gallery?.images[gallery.index];
  return (
    <InlineImageGalleryContext.Provider value={open}>
      <div ref={timelineRef} className="contents">
        {children}
      </div>
      <ImageLightbox
        imageSrc={selected ? selected.currentSrc || selected.src : null}
        imageAlt={selected?.alt ?? "Image"}
        title="Timeline image preview"
        hasMultipleImages={gallery !== null && gallery.images.length > 1}
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
