import type { WebContents } from "electron";

const requestedThrottling = new WeakMap<WebContents, boolean>();
const inactivePages = new WeakSet<WebContents>();

export function getDesktopBrowserThrottling(contents: WebContents): boolean {
  return requestedThrottling.get(contents) ?? contents.getBackgroundThrottling();
}

export function setDesktopBrowserThrottling(
  contents: WebContents,
  throttled: boolean,
): void {
  requestedThrottling.set(contents, throttled);
  if (!contents.isDestroyed())
    contents.setBackgroundThrottling(throttled || inactivePages.has(contents));
}

export function setDesktopBrowserServerActive(
  contents: WebContents,
  active: boolean,
): void {
  if (contents.isDestroyed()) return;
  const throttled = getDesktopBrowserThrottling(contents);
  if (active) inactivePages.delete(contents);
  else inactivePages.add(contents);
  setDesktopBrowserThrottling(contents, throttled);
}
