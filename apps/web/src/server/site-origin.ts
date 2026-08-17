/**
 * The absolute origin the unfurl tags advertise (og:url, og:image, twitter:image).
 *
 * Scrapers fetch those tags with no base URL to resolve against, so the values
 * have to be absolute. The fork's local-only Wrangler config provides the
 * default APP_URL, and local Cloud development overrides it with its loopback
 * gateway URL.
 *
 * Throws rather than falling back to a default — a wrong origin here is
 * invisible until someone shares a link, so a broken build is the cheaper
 * failure.
 */
export function resolveSiteOrigin(appUrl: unknown): string {
  if (typeof appUrl !== "string" || appUrl.trim() === "") {
    throw new Error(
      "APP_URL is missing from the resolved wrangler config; the unfurl tags need it to build absolute URLs",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(appUrl.trim());
  } catch {
    throw new Error(`APP_URL is not a valid URL: ${appUrl}`);
  }
  // Only the origin — APP_URL is occasionally a full URL with a path, and
  // og:image would otherwise land somewhere the asset isn't served from.
  return parsed.origin;
}
