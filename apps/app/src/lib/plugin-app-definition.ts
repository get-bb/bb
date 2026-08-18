import type { PluginAppDefinition, PluginAppSetup } from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  type CollectedPluginAppRegistrations,
} from "@get-bb/plugin-sdk/internal/plugin-app-collector";

export { collectPluginAppRegistrations };
export type { CollectedPluginAppRegistrations };

/**
 * `definePluginApp` + the host-side interpreter (plugin design §5.2). A
 * plugin's `app.tsx` default-exports `definePluginApp(setup)`; after its
 * bundle loads, the host runs `setup` against the SDK's canonical collector
 * and stores the resulting plain registration set in the slot store.
 */

/** Real `@get-bb/plugin-sdk/app` implementation of `definePluginApp`. */
export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  if (typeof setup !== "function") {
    throw new Error("definePluginApp expects a setup function");
  }
  return Object.freeze({ __bbPluginApp: true as const, setup });
}
export function isPluginAppDefinition(
  value: unknown,
): value is PluginAppDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __bbPluginApp?: unknown }).__bbPluginApp === true &&
    typeof (value as { setup?: unknown }).setup === "function"
  );
}
