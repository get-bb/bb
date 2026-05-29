import type { BbDesktopBrowserApi } from "@bb/server-contract";

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
