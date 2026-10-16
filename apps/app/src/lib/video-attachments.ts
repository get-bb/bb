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
