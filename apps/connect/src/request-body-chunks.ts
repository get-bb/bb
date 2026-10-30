import { MAX_CHUNK_BYTES } from "@bb/tunnel-contract";

export async function* requestBodyChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let parts: Uint8Array[] = [];
  let bufferedBytes = 0;
  const take = (): Uint8Array => {
    const chunk = new Uint8Array(bufferedBytes);
    let offset = 0;
    for (const part of parts) {
      chunk.set(part, offset);
      offset += part.length;
    }
    parts = [];
    bufferedBytes = 0;
    return chunk;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let offset = 0;
    while (offset < value.length) {
      const length = Math.min(
        value.length - offset,
        MAX_CHUNK_BYTES - bufferedBytes,
      );
      parts.push(value.subarray(offset, offset + length));
      bufferedBytes += length;
      offset += length;
      if (bufferedBytes === MAX_CHUNK_BYTES) yield take();
    }
  }
  if (bufferedBytes > 0) yield take();
}
