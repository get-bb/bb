import { extractErrorMessage } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import { MOBILE_APP_SURFACE_HEADER } from "@/lib/sdk/app-surface";

/**
 * One local file to send as a multipart part. React Native's networking
 * stack streams `{ uri, name, type }` form parts from disk; the SDK's Blob
 * upload cannot run here (RN builds no Blob from an ArrayBuffer) and
 * `expo/fetch` rejects uri parts, so uploads go through `XMLHttpRequest`,
 * the one request path on RN that understands native file parts.
 */
export interface MultipartFilePart {
  uri: string;
  name: string;
  type: string;
}

export interface MultipartRequest {
  url: string;
  /** Field name → string or local file. At most one file field per request. */
  fields: ReadonlyArray<readonly [string, string | MultipartFilePart]>;
}

export interface PostMultipartOptions {
  signal?: AbortSignal;
  onUploadProgress?: (fraction: number) => void;
}

function parseJsonBody(text: string): unknown {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

class MultipartNetworkError extends Error {
  constructor(message = "Network request failed") {
    super(message);
    this.name = "MultipartNetworkError";
  }
}

/**
 * POST a multipart form and parse the JSON response. Non-2xx answers raise
 * `BbHttpError` (same as the SDK) so the global mutation-error toast
 * reports the server's message; transport failures raise a `TypeError`-like
 * `MultipartNetworkError` (matched by the transient-error heuristics).
 */
export function postMultipart<T>(
  request: MultipartRequest,
  options: PostMultipartOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    for (const [name, value] of request.fields) {
      if (typeof value === "string") {
        form.append(name, value);
      } else {
        // RN-only form part; the global FormData type is the DOM one.
        (
          form as unknown as { append(n: string, v: MultipartFilePart): void }
        ).append(name, value);
      }
    }
    const onAbort = () => {
      xhr.abort();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException("Upload aborted", "AbortError"));
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    xhr.open("POST", request.url);
    xhr.setRequestHeader(
      MOBILE_APP_SURFACE_HEADER.name,
      MOBILE_APP_SURFACE_HEADER.value,
    );
    xhr.setRequestHeader("Accept", "application/json");
    if (options.onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          options.onUploadProgress?.(event.loaded / event.total);
        }
      };
    }
    xhr.onload = () => {
      cleanup();
      const body = parseJsonBody(xhr.responseText ?? "");
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      reject(
        new BbHttpError({
          body,
          code: errorCode(body),
          message:
            extractErrorMessage(body) ??
            (xhr.statusText || `Request failed with status ${xhr.status}`),
          status: xhr.status,
        }),
      );
    };
    xhr.onerror = () => {
      cleanup();
      reject(new MultipartNetworkError());
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new MultipartNetworkError("Network request timed out"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    xhr.send(form);
  });
}
