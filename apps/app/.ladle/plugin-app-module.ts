import type { PluginAppDefinition } from "@get-bb/plugin-sdk";
import { isPluginAppDefinition } from "@/lib/plugin-app-definition";

export async function loadPluginAppDefinition(
  modules: Record<string, () => Promise<unknown>>,
): Promise<PluginAppDefinition> {
  const entries = Object.entries(modules);
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    throw new Error(
      `expected one plugin app module, found ${entries.length}: ${Object.keys(modules).join(", ")}`,
    );
  }
  const [path, load] = entry;
  const module = await load();
  const definition =
    typeof module === "object" && module !== null && "default" in module
      ? module.default
      : undefined;
  if (!isPluginAppDefinition(definition)) {
    throw new Error(`${path} exports no plugin app definition`);
  }
  return definition;
}
