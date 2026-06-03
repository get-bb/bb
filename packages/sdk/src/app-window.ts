import type { ApplicationId } from "@bb/domain";
import type {
  CurrentAppDataArea,
  CurrentAppMessageArea,
} from "./areas/apps.js";
import type {
  BbRealtimeEventName,
  BbRealtimeOnInput,
  BbRealtimeUnsubscribe,
} from "./realtime-types.js";

export interface InjectedAppWindowBb {
  appId?: ApplicationId;
  applicationId?: ApplicationId;
  data: CurrentAppDataArea;
  message: CurrentAppMessageArea;
  on<TEventName extends BbRealtimeEventName>(
    input: BbRealtimeOnInput<TEventName>,
  ): BbRealtimeUnsubscribe;
}
