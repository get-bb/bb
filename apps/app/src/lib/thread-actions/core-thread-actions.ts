import coreThreadActions from "@/core-contributions/thread-actions";
import { collectCoreContributionSlots } from "@/lib/core-contributions";

export const CORE_THREAD_ACTIONS = collectCoreContributionSlots(
  coreThreadActions,
  "threadActions",
);
