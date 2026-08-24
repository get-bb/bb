import type { Context } from "hono";

/**
 * Serve plugin-authored image bytes — a branding icon or logo, a declared
 * icon, a provider logo — from BB's own origin. The bytes passed the SVG
 * validator at load, but they are still third-party markup on a first-party
 * origin, so every such response carries the headers an untrusted SVG
 * document needs: `nosniff` pins the declared content type, and the CSP lets
 * nothing load or run even if an `<svg>` were opened as a top-level document
 * (inline `style` stays allowed, so artwork still paints). Caching is the
 * caller's policy: immutable behind a matching content hash, `no-store`
 * otherwise.
 */
export function pluginImageResponse(
  // `body` is the one member the typed and untyped route contexts share.
  context: Pick<Context, "body">,
  asset: { bytes: Uint8Array; contentType: string },
  cacheControl: string,
): Response {
  return context.body(new Uint8Array(asset.bytes), 200, {
    "content-type": asset.contentType,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "cache-control": cacheControl,
  });
}
