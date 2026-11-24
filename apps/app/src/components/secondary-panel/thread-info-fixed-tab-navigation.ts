import { CORE_PLUGIN_ID } from "@bb/domain";
import { getThreadFixedTabOwnerId } from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";

export const THREAD_INFO_FIXED_TAB_REFERENCE: AppFixedTabReference = {
  ownerId: getThreadFixedTabOwnerId(CORE_PLUGIN_ID),
  tabId: "info",
};
