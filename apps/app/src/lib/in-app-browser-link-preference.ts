import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "./browser-storage";

export const OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY = "bb.openLinksInAppBrowser";

/**
 * Default ON: the feature routes bb links into the desktop in-app browser
 * instead of the external OS browser. Users can turn it OFF to fall back to the
 * external-open behavior. The preference only has an effect on desktop builds
 * (see {@link resolveUrlOpenTarget}); on web there is no in-app browser.
 */
export const OPEN_LINKS_IN_APP_BROWSER_DEFAULT = true;

export type UrlOpenTarget =
  | "in-app-browser"
  | "external-browser"
  | "unhandled";

interface ResolveUrlOpenTargetArgs {
  /** Whether the desktop in-app browser surface is available in this build. */
  desktopBrowserAvailable: boolean;
  /** The persisted user preference. */
  openLinksInAppBrowser: boolean;
  /** The link's resolved href. */
  url: string;
}

interface OpenUrlByPreferenceArgs extends ResolveUrlOpenTargetArgs {
  openExternalBrowser: (url: string) => void;
  openInAppBrowser: (url: string) => void;
}

// Only ordinary web links are owned by this preference. mailto:, file://,
// relative app routes, and other non-http schemes stay on their existing path.
const HTTP_URL_SCHEME_PATTERN = /^https?:\/\//iu;

export function isHttpOrHttpsUrl(url: string): boolean {
  return HTTP_URL_SCHEME_PATTERN.test(url);
}

/**
 * Decides where an ordinary web URL should open. Non-http(s) links are
 * deliberately unhandled so file links, app routes, mailto links, and other
 * schemes keep their dedicated behavior.
 */
export function resolveUrlOpenTarget({
  desktopBrowserAvailable,
  openLinksInAppBrowser,
  url,
}: ResolveUrlOpenTargetArgs): UrlOpenTarget {
  if (!isHttpOrHttpsUrl(url)) {
    return "unhandled";
  }
  if (desktopBrowserAvailable && openLinksInAppBrowser) {
    return "in-app-browser";
  }
  return "external-browser";
}

export function openUrlByPreference({
  desktopBrowserAvailable,
  openExternalBrowser,
  openInAppBrowser,
  openLinksInAppBrowser,
  url,
}: OpenUrlByPreferenceArgs): boolean {
  const target = resolveUrlOpenTarget({
    desktopBrowserAvailable,
    openLinksInAppBrowser,
    url,
  });

  switch (target) {
    case "in-app-browser":
      openInAppBrowser(url);
      return true;
    case "external-browser":
      openExternalBrowser(url);
      return true;
    case "unhandled":
      return false;
  }
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
