import {
  createInjectedBbSdk,
  type AppRuntimeBootstrap,
} from "./app-runtime-core.js";
import type { InjectedAppWindowBb } from "./app-window.js";
import { wrapStandardWebsocket } from "./realtime-client.js";

declare global {
  interface Window {
    __BB_APP_RUNTIME_BOOTSTRAP__?: AppRuntimeBootstrap;
  }
}

function requireBootstrap(): AppRuntimeBootstrap {
  const bootstrap = window.__BB_APP_RUNTIME_BOOTSTRAP__;
  if (!bootstrap) {
    throw new Error("BB app runtime bootstrap is missing.");
  }
  return bootstrap;
}

const bb = createInjectedBbSdk({
  bootstrap: requireBootstrap(),
  fetch: window.fetch.bind(window),
  websocket: (url) => wrapStandardWebsocket(new WebSocket(url)),
}) satisfies InjectedAppWindowBb;

try {
  Object.defineProperty(window, "bb", {
    configurable: true,
    value: bb,
    writable: false,
  });
} catch (error) {
  window.bb = bb;
}
