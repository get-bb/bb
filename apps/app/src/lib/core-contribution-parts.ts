import { coreThreadInfoRegistrations } from "./plugin-slots";
import coreMessageTime from "@/core-contributions/message-time";
import coreThreadActions from "@/core-contributions/thread-actions";
import coreThreadOutline from "@/core-contributions/thread-outline";
import { CORE_PLUGIN_ID } from "@bb/domain";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { loadLazyComponents, loadLazyPartsIn } from "./lazy-parts";
import {
  restoredPartComponents,
  type RestoredLazyPart,
} from "./restored-lazy-parts";

const CORE_CONTRIBUTIONS = [coreMessageTime, coreThreadActions, coreThreadOutline];

export function preloadCoreContributionParts(): void {
  for (const definition of CORE_CONTRIBUTIONS) {
    void loadLazyPartsIn(collectPluginAppRegistrations(definition));
  }
}

export function startRestoredCoreContributionParts(
  parts: readonly RestoredLazyPart[],
): void {
  void loadLazyComponents(
    parts.flatMap((part) =>
      restoredPartComponents(part, CORE_PLUGIN_ID, coreThreadInfoRegistrations),
    ),
  );
}
