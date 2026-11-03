import type { ComposerAttachment } from "@get-bb/plugin-sdk/app";

export function isImageAttachment(attachment: ComposerAttachment): boolean {
  return (
    attachment.type === "localImage" ||
    attachment.mimeType?.toLowerCase().startsWith("image/") === true
  );
}

export function isVideoAttachment({
  path,
  mimeType,
}: {
  path: string;
  mimeType?: string;
}): boolean {
  return (
    mimeType?.toLowerCase().startsWith("video/") === true ||
    /\.(mp4|m4v|mov|webm|ogv|ogg)(?:[?#].*)?$/i.test(path)
  );
}

export function wrappedIndex({
  currentIndex,
  direction,
  itemCount,
}: {
  currentIndex: number;
  direction: "next" | "previous";
  itemCount: number;
}): number {
  if (itemCount <= 0) {
    return currentIndex;
  }
  if (direction === "previous") {
    return currentIndex === 0 ? itemCount - 1 : currentIndex - 1;
  }
  return currentIndex === itemCount - 1 ? 0 : currentIndex + 1;
}
