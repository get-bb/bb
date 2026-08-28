type SiteAppUrlInput = string | undefined;

export function resolveSiteOrigin(appUrl: SiteAppUrlInput): string {
  if (appUrl === undefined || appUrl.trim() === "") {
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
  return parsed.origin;
}
