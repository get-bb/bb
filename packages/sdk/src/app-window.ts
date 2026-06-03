import type { ApplicationId } from "@bb/domain";
import type {
  CurrentAppDataArea,
  CurrentAppMessageArea,
} from "./areas/apps.js";

export interface InjectedAppWindowBb {
  appId?: ApplicationId;
  applicationId?: ApplicationId;
  data: CurrentAppDataArea;
  message: CurrentAppMessageArea;
}
