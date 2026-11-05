import { createContext, type ReactNode } from "react";

export type FilePreviewRenderPreview = (file: {
  content: string;
  url: string;
}) => ReactNode;

export const FilePreviewRenderPreviewContext =
  createContext<FilePreviewRenderPreview | null>(null);
