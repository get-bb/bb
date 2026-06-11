import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopInfo,
} from "@bb/server-contract";

/**
 * A no-op {@link BbDesktopBrowserApi} for tests that build a full
 * `BbDesktopApi` stub. The browser control surface is exercised separately; here
 * it just needs to satisfy the contract.
 */
export function createNoopDesktopBrowserApi(): BbDesktopBrowserApi {
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

/**
 * A full {@link BbDesktopApi} stub for tests that need `window.bbDesktop`. The
 * update/info methods echo `info`; theme and external-open are no-ops. Pass a
 * custom `browser` to exercise the browser control surface. Tests that drive
 * live info changes or assert on method spies build their own stub instead.
 */
export function createBbDesktopApi(
  info: BbDesktopInfo,
  browser: BbDesktopBrowserApi = createNoopDesktopBrowserApi(),
): BbDesktopApi {
  return {
    ...info,
    browser,
    async checkForUpdates() {
      return info;
    },
    async getInfo() {
      return info;
    },
    async installUpdate() {},
    onChange() {
      return () => {};
    },
    setTheme() {},
    openExternalUrl() {},
  };
}
