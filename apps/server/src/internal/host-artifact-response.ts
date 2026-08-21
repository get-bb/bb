import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Serving one executable artifact to an enrolled daemon — a plugin host
 * bundle or a provider bridge bundle. One shape for both, because the trust
 * model is one thing: blanket daemon auth on `/internal/*`, the digest is the
 * capability, anything odd is an indistinguishable 404, and the daemon
 * hash-verifies the bytes before it caches or executes them.
 *
 * Streamed from disk rather than read whole. A bundle is megabytes and every
 * enrolled daemon fetches it, so buffering one per request is server memory
 * proportional to fleet size for no gain: the server cannot make the bytes
 * trustworthy anyway — only the daemon's own verification does that. The
 * recorded byte length is checked against the file so a stale registry entry
 * cannot stream a truncated or swapped file under a digest that will not
 * match.
 */
export async function hostArtifactFileResponse(args: {
  path: string;
  byteLength: number;
  digest: string;
}): Promise<Response | null> {
  const stats = await stat(args.path).catch(() => null);
  if (stats === null || !stats.isFile() || stats.size !== args.byteLength) {
    return null;
  }
  const body = Readable.toWeb(
    createReadStream(args.path),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      // Content-addressed, so the bytes behind a digest never change.
      "cache-control": "private, immutable, max-age=31536000",
      "content-length": String(args.byteLength),
      "content-type": "text/javascript; charset=utf-8",
      etag: `"${args.digest}"`,
    },
  });
}
