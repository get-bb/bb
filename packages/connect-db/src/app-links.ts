// bb mobile app-link association files (iOS universal links, Android app
// links). Served unauthenticated from every bare `<label>.getbb.app` by the
// connect gate (before the session check) and from the apex by bb-web, so a
// `https://<handle>.getbb.app/threads/<id>` link opens the app when it is
// installed. Share hosts (`<label>--<port>.getbb.app`) front arbitrary local
// apps, not a bb server, so the gate does not answer there. Single source of
// truth for the app ids and the path allowlist.

/** Apple team id + iOS bundle id of the bb mobile app. */
export const BB_MOBILE_IOS_APP_ID = "9QCU24SXK5.app.getbb.mobile";
/** Android application id of the bb mobile app. */
export const BB_MOBILE_ANDROID_PACKAGE = "app.getbb.mobile";

/**
 * Web paths the app claims (mirrors `apps/mobile/app.json`: iOS
 * `associatedDomains`, Android `intentFilters`). Everything else stays in
 * the browser.
 */
const BB_MOBILE_APP_LINK_PATHS: readonly string[] = [
  "/threads/*",
  "/projects/*",
  "/settings/*",
];

export const APPLE_APP_SITE_ASSOCIATION_PATH =
  "/.well-known/apple-app-site-association";
export const ANDROID_ASSET_LINKS_PATH = "/.well-known/assetlinks.json";

/**
 * `https://developer.apple.com/documentation/xcode/supporting-associated-domains`
 * — the modern `appIDs` + `components` form only. Apple TN3155 says not to
 * mix it with the legacy `appID` + `paths` keys (unexpected universal-link
 * behaviour), and the app's minimum iOS is well past 13.5 where the legacy
 * keys mattered. Served as `application/json` with no redirects.
 */
function buildAppleAppSiteAssociation(): Record<string, unknown> {
  return {
    applinks: {
      details: [
        {
          appIDs: [BB_MOBILE_IOS_APP_ID],
          components: BB_MOBILE_APP_LINK_PATHS.map((path) => ({
            "/": path,
          })),
        },
      ],
    },
  };
}

/**
 * Parse the `ASSETLINKS_SHA256_FINGERPRINTS` env var (comma / whitespace
 * separated `AA:BB:…` signing-cert fingerprints). Empty → no fingerprints →
 * Android cannot verify the app (the file still serves so the allowlist is
 * discoverable and the deploy does not depend on the signing key).
 */
export function parseAssetLinksFingerprints(
  value: string | undefined | null,
): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0);
}

/** `https://developers.google.com/digital-asset-links/v1/getting-started` */
function buildAndroidAssetLinks(
  sha256CertFingerprints: readonly string[],
): unknown[] {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: BB_MOBILE_ANDROID_PACKAGE,
        sha256_cert_fingerprints: [...sha256CertFingerprints],
      },
    },
  ];
}

/**
 * Answer a `GET`/`HEAD` for either association file, or `null` when the
 * request is for something else. Shared by the gate worker and bb-web so the
 * two never drift. Cacheable for an hour (Apple's CDN refetches on its own
 * schedule; a redeploy with new ids does not need an instant flip).
 */
export function handleAppLinkAssociationRequest(
  request: { method: string; url: string },
  env: { ASSETLINKS_SHA256_FINGERPRINTS?: string },
): Response | null {
  const { pathname } = new URL(request.url);
  let body: unknown;
  if (pathname === APPLE_APP_SITE_ASSOCIATION_PATH) {
    body = buildAppleAppSiteAssociation();
  } else if (pathname === ANDROID_ASSET_LINKS_PATH) {
    body = buildAndroidAssetLinks(
      parseAssetLinksFingerprints(env.ASSETLINKS_SHA256_FINGERPRINTS),
    );
  } else {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed\n", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
}
