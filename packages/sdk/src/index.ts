import { createBbSdk } from "./core.js";
import { createHttpTransport } from "./transport-http.js";

export const bb = createBbSdk({
  transport: createHttpTransport({ runtime: "browser" }),
});

export { createBbSdk, createHttpTransport };
export {
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
} from "./response.js";
export type { BbSdk, CreateBbSdkArgs } from "./core.js";
export type { InjectedAppWindowBb } from "./app-window.js";
export type {
  BbRealtimeSocketFactory,
  BbSdkContext,
  BbSdkRuntime,
  BbSdkTransport,
} from "./transport.js";
export type { FetchImplementation } from "./response.js";
export type * from "./realtime.js";
export type * from "./areas/apps.js";
export type * from "./areas/environments.js";
export type * from "./areas/hosts.js";
export type * from "./areas/managers.js";
export type * from "./areas/projects.js";
export type * from "./areas/providers.js";
export type * from "./areas/replay.js";
export type * from "./areas/status.js";
export type * from "./areas/threads.js";
