import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "./browser-storage";

export const OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY = "bb.openLinksInAppBrowser";

/**
 * Default ON: the feature routes chat links into the desktop in-app browser
 * instead of the external OS browser. Users can turn it OFF to fall back to the
 * external-open behavior. The preference only has an effect on desktop builds
 * (see {@link resolveChatLinkOpenTarget}); on web there is no in-app browser.
 */
export const OPEN_LINKS_IN_APP_BROWSER_DEFAULT = true;

export type ChatLinkOpenTarget = "in-app-browser" | "default";

interface ResolveChatLinkOpenTargetArgs {
  /** Whether the desktop in-app browser surface is available in this build. */
  desktopBrowserAvailable: boolean;
  /** The persisted user preference. */
  openInAppBrowser: boolean;
  /** The link's resolved href. */
  url: string;
}

// Only ordinary web links are routed into the in-app browser. mailto:, file://,
// relative app routes, and other non-http schemes keep their default behavior.
const HTTP_URL_SCHEME_PATTERN = /^https?:\/\//iu;

export function isHttpOrHttpsUrl(url: string): boolean {
  return HTTP_URL_SCHEME_PATTERN.test(url);
}

/**
 * Decides where a chat link click should open. Returns `"in-app-browser"` only
 * when the desktop browser surface exists, the user preference is on, and the
 * href is a normal http(s) URL. Every other case returns `"default"`, leaving
 * the anchor's existing behavior (external open for web links, internal routing
 * for relative links, mail client for mailto, etc.) untouched.
 */
export function resolveChatLinkOpenTarget({
  desktopBrowserAvailable,
  openInAppBrowser,
  url,
}: ResolveChatLinkOpenTargetArgs): ChatLinkOpenTarget {
  if (desktopBrowserAvailable && openInAppBrowser && isHttpOrHttpsUrl(url)) {
    return "in-app-browser";
  }
  return "default";
}

const openLinksInAppBrowserStorage = createJsonLocalStorage<boolean>();

export const openLinksInAppBrowserPreferenceAtom = atomWithStorage<boolean>(
  OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY,
  OPEN_LINKS_IN_APP_BROWSER_DEFAULT,
  openLinksInAppBrowserStorage,
  { getOnInit: true },
);

export function useOpenLinksInAppBrowserPreference() {
  return useAtom(openLinksInAppBrowserPreferenceAtom);
}
