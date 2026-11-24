import type { PluginAppDefinition } from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  type CollectedPluginAppRegistrations,
} from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { CORE_PLUGIN_ID } from "@bb/domain";

type CoreContributionKind =
  | "tabs"
  | "messageMetadata"
  | "threadContextSegments"
  | "threadActions"
  | "threadRailOutlines";

export type CoreContributionSlot<Kind extends CoreContributionKind> =
  CollectedPluginAppRegistrations[Kind][number] & {
    pluginId: typeof CORE_PLUGIN_ID;
    generation: 0;
  };

export function collectCoreContributionSlots<Kind extends CoreContributionKind>(
  definition: PluginAppDefinition,
  kind: Kind,
): readonly CoreContributionSlot<Kind>[] {
  const slots: readonly CollectedPluginAppRegistrations[Kind][number][] =
    collectPluginAppRegistrations(definition)[kind];
  return slots.map((slot) => ({
    ...slot,
    pluginId: CORE_PLUGIN_ID,
    generation: 0,
  }));
}
