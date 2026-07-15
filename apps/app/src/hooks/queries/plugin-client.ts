import { createBrowserBbSdk } from "@bb/sdk/browser";

type FetchLike = typeof fetch;

/**
 * Chromium's native fetch requires the Window receiver. Query helpers accept a
 * fetch implementation for tests, so bind it once at this boundary before the
 * SDK stores and invokes it later.
 */
export function createPluginsClient(fetchImpl: FetchLike) {
  return createBrowserBbSdk({ fetch: fetchImpl.bind(globalThis) }).plugins;
}
