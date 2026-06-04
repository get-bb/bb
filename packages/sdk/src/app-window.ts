import type { ApplicationId } from "@bb/domain";
import type {
  CurrentAppDataArea,
  CurrentAppMessageArea,
} from "./areas/apps.js";
import type { BbRealtime } from "./realtime-types.js";

/**
 * The stable contract for the `window.bb` runtime injected into served app
 * pages. The installed object is the full SDK (`InjectedBbSdk` in
 * app-runtime-core.ts); this interface declares the subset app authors
 * should rely on. The runtime always knows which app it serves, so both id
 * fields are required.
 */
export interface InjectedAppWindowBb extends BbRealtime {
  /** @deprecated Alias of `applicationId`. */
  appId: ApplicationId;
  applicationId: ApplicationId;
  data: CurrentAppDataArea;
  message: CurrentAppMessageArea;
}
