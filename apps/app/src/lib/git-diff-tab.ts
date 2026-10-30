import { GIT_PLUGIN_ID } from "@bb/domain";
import { GIT_DIFF_TAB_ID } from "bb-plugin-bb--git/contract";
import { getThreadFixedTabOwnerId } from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";

export const GIT_DIFF_TAB_REFERENCE: AppFixedTabReference = {
  ownerId: getThreadFixedTabOwnerId(GIT_PLUGIN_ID),
  tabId: GIT_DIFF_TAB_ID,
};
