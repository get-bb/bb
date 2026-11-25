import coreMessageTime from "@/core-contributions/message-time";
import coreThreadActions from "@/core-contributions/thread-actions";
import coreThreadOutline from "@/core-contributions/thread-outline";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { loadLazyPartsIn } from "./lazy-parts";

const CORE_CONTRIBUTIONS = [coreMessageTime, coreThreadActions, coreThreadOutline];

export function preloadCoreContributionParts(): void {
  for (const definition of CORE_CONTRIBUTIONS) {
    void loadLazyPartsIn(collectPluginAppRegistrations(definition));
  }
}
