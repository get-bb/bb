import { createBrowserBbSdk } from "@bb/sdk/browser";
import { appSurfaceRequestInit } from "@/lib/app-surface";

type FetchLike = typeof fetch;

/**
 * Chromium's native fetch requires the Window receiver. Query helpers accept a
 * fetch implementation for tests, so bind it once at this boundary before the
 * SDK stores and invokes it later.
 */
export function createPluginsClient(fetchImpl: FetchLike) {
  const fetchWithAppSurface: FetchLike = (input, init) =>
    fetchImpl.call(globalThis, input, appSurfaceRequestInit(init));
  return createBrowserBbSdk({ fetch: fetchWithAppSurface }).plugins;
}
