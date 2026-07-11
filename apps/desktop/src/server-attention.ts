import { systemAttentionResponseSchema } from "@bb/server-contract";

export const SERVER_ATTENTION_POLL_INTERVAL_MS = 5_000;
export const SERVER_ATTENTION_REQUEST_TIMEOUT_MS = 2_000;

export type ServerAttentionFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function fetchServerAttention(args: {
  fetchImpl: ServerAttentionFetch;
  serverUrl: string;
  timeoutMs: number;
}): Promise<boolean | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, args.timeoutMs);

  try {
    const url = new URL("/api/v1/system/attention", args.serverUrl).toString();
    const response = await args.fetchImpl(url, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const parsed = systemAttentionResponseSchema.safeParse(
      await response.json(),
    );
    return parsed.success ? parsed.data.hasAttention : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
