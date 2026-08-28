import type { PluginAppDefinition, PluginAppSetup } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  collectPluginAppRegistrations,
  type CollectedPluginAppRegistrations,
} from "@get-bb/plugin-sdk/internal/plugin-app-collector";

export { collectPluginAppRegistrations };
export type { CollectedPluginAppRegistrations };

const pluginAppSetupSchema = z.function();
const pluginAppDefinitionSchema = z.object({
  __bbPluginApp: z.literal(true),
  setup: pluginAppSetupSchema,
});

export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  if (!pluginAppSetupSchema.safeParse(setup).success) {
    throw new Error("definePluginApp expects a setup function");
  }
  return Object.freeze({ __bbPluginApp: true as const, setup });
}
export function isPluginAppDefinition<Value>(
  value: Value,
): value is Value & PluginAppDefinition {
  return pluginAppDefinitionSchema.safeParse(value).success;
}
