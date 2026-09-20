import { createContext } from "react";
import type { ThreadImageMetadata } from "@bb/server-contract";

export interface MarkdownImageDimensions {
  width: number;
  height: number;
}

export const MarkdownImageMetadataContext = createContext<{
  read: (source: string) => ThreadImageMetadata | undefined;
  remember: (
    source: string,
    dimensions: MarkdownImageDimensions,
    etag: string | null,
  ) => void;
} | null>(null);

export function markdownImageSourceIdentity(source: string): string | null {
  try {
    const url = new URL(source, window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href;
  } catch {
    return null;
  }
}
