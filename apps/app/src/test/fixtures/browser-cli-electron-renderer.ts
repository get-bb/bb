import { browserAutomationClient } from "../../lib/browser-automation-client";
import { getDesktopBrowserApi } from "../../lib/bb-desktop";
import { wsManager } from "../../lib/ws";

const params = new URLSearchParams(window.location.search);
const threadId = params.get("threadId");
if (threadId === null) throw new Error("threadId is required");
const desktopBrowser = getDesktopBrowserApi();
if (desktopBrowser === null) throw new Error("Desktop Browser API is unavailable");

const tabIds = new Set<string>();
let nextTab = 1;
const reportTabs = () => browserAutomationClient.reportBrowserTabs(threadId, tabIds);
const unregisterHost = browserAutomationClient.registerThreadHost(threadId, {
  closeBrowserTab(tabId) {
    desktopBrowser.detach(tabId);
    tabIds.delete(tabId);
    reportTabs();
  },
  openBrowserTab(url) {
    const tabId = `browser:cli-e2e-${nextTab++}`;
    tabIds.add(tabId);
    setTimeout(() => {
      desktopBrowser.attach({
        bounds: { x: 0, y: 0, width: 900, height: 700 },
        tabId,
        url,
        visible: true,
      });
      desktopBrowser.setVisible({ tabId, visible: true });
      reportTabs();
    }, 0);
    return tabId;
  },
  reveal() {},
});
const stopClient = browserAutomationClient.start();
const unsubscribeConnected = wsManager.onConnected(() => {
  setTimeout(() => console.log(JSON.stringify({ fixture: "renderer-ready" })), 250);
});
wsManager.subscribe({ kind: "thread-detail", threadId });
wsManager.connect();

window.addEventListener("beforeunload", () => {
  wsManager.unsubscribe({ kind: "thread-detail", threadId });
  unsubscribeConnected();
  stopClient();
  unregisterHost();
  wsManager.disconnect();
});
