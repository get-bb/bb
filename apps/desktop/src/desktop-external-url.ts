const EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function resolveDesktopExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return EXTERNAL_URL_PROTOCOLS.has(url.protocol) ? url.href : null;
}
