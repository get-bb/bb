import { MOBILE_APP_SURFACE_HEADER } from "./app-surface";

export interface MobileFetchOptions {
  /**
   * Called for every 401/403 response. The bb server itself never answers
   * the app's routes with those statuses; they come from the connect gate
   * when the session cookie is missing, expired, or the machine credential
   * was revoked, so the owner can re-check the session.
   */
  onAuthFailure?: (status: number) => void;
}

/**
 * Wrap a fetch so every request carries the mobile app-surface header and
 * auth rejections are reported.
 *
 * Never spread a `Headers` instance into the init on React Native: its
 * polyfill exposes internal fields as enumerable props and `expo/fetch`
 * then fails to cast the init. Always rebuild via `new Headers(...)`.
 */
export function createMobileFetch(
  baseFetch: typeof fetch,
  options: MobileFetchOptions = {},
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(
      MOBILE_APP_SURFACE_HEADER.name,
      MOBILE_APP_SURFACE_HEADER.value,
    );
    const response = await baseFetch(input, { ...init, headers });
    if (response.status === 401 || response.status === 403) {
      options.onAuthFailure?.(response.status);
    }
    return response;
  };
}
