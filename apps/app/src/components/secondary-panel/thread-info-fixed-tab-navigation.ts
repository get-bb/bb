import type { AppFixedTabDestination } from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";

export const THREAD_INFO_FIXED_TAB_REFERENCE: AppFixedTabReference = {
  ownerId: "core:thread-info",
  tabId: "info",
};

export function createThreadInfoFixedTabDestination(
  open: () => void,
): AppFixedTabDestination {
  return {
    tab: THREAD_INFO_FIXED_TAB_REFERENCE,
    open(target) {
      if (target !== undefined) return false;
      open();
      return true;
    },
  };
}
