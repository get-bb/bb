import { createContext } from "react";

export interface InlineGalleryImage {
  rowId: string;
  imageIndex: number;
  src: string;
  alt: string;
}

export const InlineImageGalleryContext = createContext<
  ((image: InlineGalleryImage) => void) | null
>(null);

export const InlineImageMessageContext = createContext<string | null>(null);
