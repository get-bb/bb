import { createBrowserBbSdk, type BrowserBbSdk } from "@bb/sdk/browser";
import type { ServerProfile } from "../profiles/profile";
import {
  createMobileRealtime,
  type CreateMobileRealtimeOptions,
  type MobileRealtime,
} from "../realtime/mobile-realtime";
import { realtimeUrlForServer } from "../realtime/realtime-url";
import { createMobileFetch, type MobileFetchOptions } from "./mobile-fetch";

export interface MobileSdk {
  sdk: BrowserBbSdk;
  realtime: MobileRealtime;
  /**
   * The SDK's fetch (app-surface header + auth-failure reporting) for the
   * few binary routes read outside the SDK (raw file content).
   */
  fetch: typeof fetch;
}

export interface CreateMobileSdkOptions {
  /** Defaults to the global fetch (`expo/fetch` on device). */
  fetch?: typeof fetch;
  /** See {@link MobileFetchOptions.onAuthFailure}. */
  onAuthFailure?: MobileFetchOptions["onAuthFailure"];
  /** Injection points for tests; the URL is derived from the profile. */
  realtime?: Omit<CreateMobileRealtimeOptions, "url">;
}

/**
 * Build the SDK + realtime pair for one server profile. The SDK's own
 * realtime client is not used (it drops non-`changed` frames); `realtime`
 * is the WebSocketManager-shaped manager the hooks subscribe through.
 * Cookies (connect mode) come from the native jar; nothing to add here.
 */
export function createMobileSdk(
  profile: Pick<ServerProfile, "serverUrl">,
  options: CreateMobileSdkOptions = {},
): MobileSdk {
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const mobileFetch = createMobileFetch(baseFetch, {
    onAuthFailure: options.onAuthFailure,
  });
  const sdk = createBrowserBbSdk({
    baseUrl: profile.serverUrl,
    fetch: mobileFetch,
  });
  const realtime = createMobileRealtime({
    ...options.realtime,
    url: realtimeUrlForServer(profile.serverUrl),
  });
  return { sdk, realtime, fetch: mobileFetch };
}
