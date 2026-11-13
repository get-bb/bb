type BrowserPlatform = Pick<
  Navigator,
  "maxTouchPoints" | "platform" | "userAgent"
>;

export function isIOSWebKit({
  maxTouchPoints,
  platform,
  userAgent,
}: BrowserPlatform): boolean {
  const isAppleWebKit = /\bAppleWebKit\//u.test(userAgent);
  const isIOSDevice =
    /\b(?:iPad|iPhone|iPod)\b/u.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  return isAppleWebKit && isIOSDevice;
}

const VIEWPORT_MAXIMUM_SCALE = "maximum-scale=1";

export function preventIOSFocusZoom(
  document: Document,
  platform: BrowserPlatform,
): void {
  if (!isIOSWebKit(platform)) return;
  const viewport = document.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]',
  );
  if (!viewport || /\bmaximum-scale\s*=/u.test(viewport.content)) return;
  viewport.content = viewport.content.trim()
    ? `${viewport.content}, ${VIEWPORT_MAXIMUM_SCALE}`
    : VIEWPORT_MAXIMUM_SCALE;
}
