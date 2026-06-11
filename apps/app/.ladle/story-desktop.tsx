import { useEffect, type ReactNode } from "react";
import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopInfo,
} from "@bb/server-contract";

// A minimal, inert desktop bridge for stories that need the desktop-only browser
// surface to register as available. The browser methods are no-ops: the native
// `WebContentsView` only exists in the packaged desktop app, so in a story the
// browser tab renders its chrome + new-tab screen and never a live page.
const STORY_DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-story",
};

function createStoryDesktopBrowserApi(): BbDesktopBrowserApi {
  return {
    attach() {},
    detach() {},
    navigate() {},
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    setBounds() {},
    setVisible() {},
    onState() {
      return () => {};
    },
    onOpenTab() {
      return () => {};
    },
  };
}

function createStoryDesktopApi(): BbDesktopApi {
  return {
    ...STORY_DESKTOP_INFO,
    browser: createStoryDesktopBrowserApi(),
    async checkForUpdates() {
      return STORY_DESKTOP_INFO;
    },
    async getInfo() {
      return STORY_DESKTOP_INFO;
    },
    async installUpdate() {},
    onChange() {
      return () => {};
    },
    setTheme() {},
    openExternalUrl() {},
  };
}

interface WithDesktopBrowserProps {
  children: ReactNode;
}

/**
 * Installs an inert `window.bbDesktop` so stories can exercise the desktop-only
 * browser surface — the launcher's "Open browser" entry and the browser tab.
 * The bridge is set synchronously during render (before children read
 * `isDesktopBrowserAvailable()`, which runs at render time) and removed on
 * unmount so it never leaks into the web-build stories that must see the surface
 * as absent. Use exactly one wrapper per story page.
 */
export function WithDesktopBrowser({ children }: WithDesktopBrowserProps) {
  if (typeof window !== "undefined" && window.bbDesktop === undefined) {
    window.bbDesktop = createStoryDesktopApi();
  }
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        delete window.bbDesktop;
      }
    };
  }, []);
  return <>{children}</>;
}
