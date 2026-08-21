/**
 * The absolute origin the unfurl tags advertise (og:url, og:image, twitter:image).
 *
 * Scrapers fetch those tags with no base URL to resolve against, so the values
 * have to be absolute — which means the build has to know which deployment it
 * is. CLOUDFLARE_ENV already picks the wrangler env at build time (see
 * .github/workflows/deploy-web.yml), so the origin is read back out of the same
 * APP_URL the worker will run with: a staging share advertises staging instead
 * of claiming to be getbb.app.
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
