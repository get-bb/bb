import { createContext } from "react";

export const InlineImageGalleryContext = createContext<
  ((image: HTMLImageElement) => void) | null
>(null);
