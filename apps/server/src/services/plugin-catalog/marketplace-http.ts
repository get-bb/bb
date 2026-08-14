/** Injected so tests drive refreshes without real network access. */
export type MarketplaceFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export const MARKETPLACE_FETCH_TIMEOUT_MS = 10_000;

export function marketplaceErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `request timed out after ${MARKETPLACE_FETCH_TIMEOUT_MS}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a response body with a hard byte cap. The declared length is checked
 * first so an oversize body is refused before it is downloaded, and the stream
 * is cancelled as soon as the cap is passed — a hostile server cannot stream
 * unbounded bytes into memory.
 */
export async function boundedResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds ${maxBytes} bytes`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
