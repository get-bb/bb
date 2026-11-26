import childThreads from "@/core-contributions/child-threads";
import parentThread from "@/core-contributions/parent-thread";
import { collectCoreContributionSlots } from "@/lib/core-contributions";

export const CORE_THREAD_CONTEXT_ITEMS = [parentThread, childThreads].flatMap(
  (definition) =>
    collectCoreContributionSlots(definition, "threadContextItems"),
);
