import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ImageLightbox,
  getWrappedImageIndex,
} from "@/components/ui/image-lightbox";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";

interface ImageTabLightboxValue {
  isOpen: boolean;
  open: (image: ImageTabLightboxImage) => void;
  update: (image: ImageTabLightboxImage) => void;
}

interface ImageTabLightboxImage {
  alt: string;
  src: string;
}

interface ImageTabLightboxProviderProps {
  activeTabId: string | null;
  children: ReactNode;
  tabs: readonly SecondaryPanelRenderableTab[];
}

const IMAGE_FILE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

const ImageTabLightboxContext = createContext<ImageTabLightboxValue | null>(
  null,
);

function isImageFileTab(tab: SecondaryPanelRenderableTab): boolean {
  if (
    tab.tab.kind !== "workspace-file-preview" &&
    tab.tab.kind !== "host-file-preview" &&
    tab.tab.kind !== "thread-storage-file-preview"
  ) {
    return false;
  }
  const extension = tab.tab.path.split(".").pop()?.toLowerCase();
  return extension !== undefined && IMAGE_FILE_EXTENSIONS.has(extension);
}

export function ImageTabLightboxProvider({
  activeTabId,
  children,
  tabs,
}: ImageTabLightboxProviderProps) {
  const [image, setImage] = useState<ImageTabLightboxImage | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [imagesByTabId, setImagesByTabId] = useState<
    ReadonlyMap<string, ImageTabLightboxImage>
  >(() => new Map());
  const imageTabs = useMemo(() => tabs.filter(isImageFileTab), [tabs]);
  const selectImageTab = useCallback(
    (index: number) => {
      const tab = imageTabs[index];
      if (tab === undefined) return;
      setImage(imagesByTabId.get(tab.tab.id) ?? null);
      tab.onSelect();
    },
    [imageTabs, imagesByTabId],
  );
  const step = useCallback(
    (direction: "previous" | "next") => {
      const currentIndex = imageTabs.findIndex(
        (tab) => tab.tab.id === activeTabId,
      );
      if (currentIndex === -1 || imageTabs.length <= 1) return;
      selectImageTab(
        getWrappedImageIndex({
          currentIndex,
          direction,
          itemCount: imageTabs.length,
        }),
      );
    },
    [activeTabId, imageTabs, selectImageTab],
  );
  const updateImage = useCallback(
    (nextImage: ImageTabLightboxImage) => {
      setImage(nextImage);
      if (activeTabId === null) return;
      setImagesByTabId((current) => {
        if (current.get(activeTabId)?.src === nextImage.src) return current;
        return new Map(current).set(activeTabId, nextImage);
      });
    },
    [activeTabId],
  );
  const value = useMemo<ImageTabLightboxValue>(
    () => ({
      isOpen,
      open: (nextImage) => {
        updateImage(nextImage);
        setIsOpen(true);
      },
      update: updateImage,
    }),
    [isOpen, updateImage],
  );

  return (
    <ImageTabLightboxContext.Provider value={value}>
      {children}
      <ImageLightbox
        imageAlt={image?.alt ?? "Image preview"}
        imageSrc={isOpen ? (image?.src ?? null) : null}
        isOpen={isOpen}
        title={image?.alt ?? "Image preview"}
        hasMultipleImages={imageTabs.length > 1}
        onPrevious={() => step("previous")}
        onNext={() => step("next")}
        onClose={() => setIsOpen(false)}
      />
    </ImageTabLightboxContext.Provider>
  );
}

export function useImageTabLightbox(): ImageTabLightboxValue | null {
  return useContext(ImageTabLightboxContext);
}
