import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export async function hostArtifactFileResponse(args: {
  path: string;
  byteLength: number;
  headers: Record<string, string>;
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
    headers: { ...args.headers, "content-length": String(args.byteLength) },
  });
}
