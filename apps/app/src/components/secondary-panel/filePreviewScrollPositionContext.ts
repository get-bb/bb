import { createContext } from "react";

export const FilePreviewScrollPositionContext = createContext<{
  scrollTop: number;
} | null>(null);
