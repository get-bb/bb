// Response-encoding rules for bodies bb connect only ever relays, never
// produces.
//
// The tunnel client forwards the origin's response bytes verbatim, including
// `content-encoding: gzip` (or br/zstd) bodies — the app server compresses its
// own HTML, API JSON, and precompressed assets. Every Response the worker
// rebuilds around those bytes must therefore tell workerd "this body is
// already encoded exactly as content-encoding says".
//
// workerd's default is `encodeBody: "automatic"`, which means the opposite:
// the runtime owns the encoding and assumes the body handed to the constructor
// is identity. Given gzip bytes plus a `content-encoding: gzip` header it drops
// the header and ships the compressed bytes labelled `text/html`, so the
// browser renders raw gzip. `encodeBody: "manual"` is the only way to hand
// workerd a pre-encoded body.
//
// `manual` is also correct for identity bodies (content-encoding absent =
// nothing to encode), so it applies to every relayed response — no need to
// branch on whether this particular origin response happened to be compressed.

/**
 * Rebuild `source` around `body` (its own body, or a tee of it) without
 * re-encoding. Fields are copied explicitly: `new Response(body, source)` reads
 * a Response's prototype getters, but those are not own properties, so they
 * cannot be spread alongside `encodeBody`.
 */
export function rebuiltResponse(
  body: BodyInit | null,
  source: Response,
): Response {
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers: source.headers,
    encodeBody: "manual",
  });
}

/**
 * Build the visitor-facing Response for a response relayed from an origin,
 * preserving the origin's own content-encoding instead of letting workerd
 * re-encode (and thereby corrupt) the body.
 */
export function relayedResponse(
  body: BodyInit | null,
  status: number,
  headers: HeadersInit,
): Response {
  return new Response(body, { status, headers, encodeBody: "manual" });
}
