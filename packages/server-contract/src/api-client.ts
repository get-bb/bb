import { hc, type ClientRequestOptions } from "hono/client";
// Type-only on purpose: the client needs the route *types* but must not pull
// the `publicApiRoutes` table (and the ~85 zod schemas it references) into
// the browser boot chunk. `sideEffects: false` lets bundlers drop
// public-api.ts entirely once nothing imports it as a value.
import type { PublicApiRoutes } from "./public-api.js";

export type PublicApiFetch = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

/** Omit the options object to use global fetch; provide it to override fetch. */
export interface PublicApiClientOptions {
  fetch: PublicApiFetch;
}

function toHonoClientOptions(
  options: PublicApiClientOptions | undefined,
): ClientRequestOptions | undefined {
  if (options === undefined) {
    return undefined;
  }
  // Hono types custom fetch as typeof fetch, but only calls the function.
  return { fetch: options.fetch as typeof fetch };
}

export function createPublicApiClient(
  baseUrl: string,
  options?: PublicApiClientOptions,
) {
  return hc<PublicApiRoutes>(`${baseUrl}/api/v1`, toHonoClientOptions(options));
}

export function createApiClient(
  baseUrl: string,
  options?: PublicApiClientOptions,
) {
  const apiClient = createPublicApiClient(baseUrl, options);
  return {
    api: {
      v1: apiClient,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
