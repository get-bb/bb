import { ApiError } from "../../errors.js";
import { requestMatchesEntityTag } from "./entity-tag.js";
import { parseSingleByteRange } from "./file-byte-range.js";

export interface FileResponseSource {
  sizeBytes: number;
  entityTag: string;
  lastModified: string;
  open(signal: AbortSignal): Promise<{
    maxChunkBytes: number;
    read(offset: number, length: number): Promise<Uint8Array>;
    close(): Promise<void>;
  }>;
}

export async function createFileStreamResponse({
  source,
  request,
  headers,
}: {
  source: FileResponseSource;
  request: Request;
  headers: Headers;
}): Promise<Response> {
  headers.set("accept-ranges", "bytes");
  headers.set("etag", source.entityTag);
  headers.set("last-modified", source.lastModified);
  if (
    headers.get("cache-control") !== "no-store" &&
    requestMatchesEntityTag(
      request.headers.get("if-none-match") ?? undefined,
      source.entityTag,
    )
  ) {
    return new Response(null, { status: 304, headers });
  }
  const ifRange = request.headers.get("if-range")?.trim();
  const rangeAllowed =
    ifRange === undefined ||
    (!source.entityTag.startsWith("W/") &&
      (ifRange === source.entityTag || ifRange === source.lastModified));
  const range =
    request.method === "GET" && rangeAllowed
      ? parseSingleByteRange(
          request.headers.get("range") ?? "",
          source.sizeBytes,
        )
      : undefined;
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${source.sizeBytes}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? source.sizeBytes - 1;
  const status = range ? 206 : 200;
  headers.set("content-length", String(end - start + 1));
  if (range)
    headers.set("content-range", `bytes ${start}-${end}/${source.sizeBytes}`);
  if (request.method === "HEAD" || source.sizeBytes === 0) {
    return new Response(null, { status, headers });
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  signal.throwIfAborted();
  const reader = await source.open(signal);
  let closePromise: Promise<void> | undefined;
  const close = () => (closePromise ??= reader.close());
  const read = async (offset: number) => {
    signal.throwIfAborted();
    const length = Math.min(reader.maxChunkBytes, end - offset + 1);
    const bytes = await reader.read(offset, length);
    signal.throwIfAborted();
    if (bytes.byteLength !== length) {
      throw new ApiError(
        409,
        "file_changed",
        "File changed or returned an incomplete chunk",
        true,
      );
    }
    return bytes;
  };
  let next = start;
  let first: Uint8Array | null;
  try {
    first = await read(next);
  } catch (error) {
    await close();
    throw error;
  }
  let cancelled = false;
  let detachAbort = () => {};
  const release = () => {
    first = null;
    detachAbort();
    return close();
  };
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const abort = () => {
          cancelled = true;
          controller.error(signal.reason);
          void release().catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        detachAbort = () => signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
      },
      async pull(controller) {
        try {
          const bytes = first ?? (await read(next));
          first = null;
          if (cancelled) return;
          next += bytes.byteLength;
          controller.enqueue(bytes);
          if (next > end) {
            await release();
            if (!cancelled) controller.close();
          }
        } catch (error) {
          if (!cancelled) controller.error(error);
          await release();
        }
      },
      async cancel(reason) {
        cancelled = true;
        detachAbort();
        cancellation.abort(reason);
        await release();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status, headers });
}
