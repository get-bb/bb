import type { BbPluginRuntime } from "./plugin-frontend";
import { createRetryingModuleLoader } from "./plugin-frontend-lazy";

interface PluginRuntimeGroup {
  slots: (keyof BbPluginRuntime)[];
  load: () => Promise<Partial<BbPluginRuntime>>;
}

const lazyPluginRuntimeGroups: PluginRuntimeGroup[] = [
  {
    slots: ["pierreDiffs", "pierreDiffsReact"],
    load: createRetryingModuleLoader(async () => {
      const { pierreRuntimeSlots } = await import("./plugin-pierre-runtime");
      return pierreRuntimeSlots;
    }),
  },
  {
    slots: ["zod"],
    load: createRetryingModuleLoader(async () => {
      const { zodRuntimeSlots } = await import("./plugin-zod-runtime");
      return zodRuntimeSlots;
    }),
  },
];

export function pluginRuntimeGroupsFor(
  runtimeSlots: readonly string[],
): PluginRuntimeGroup[] {
  return lazyPluginRuntimeGroups.filter((group) =>
    group.slots.some((slot) => runtimeSlots.includes(slot)),
  );
}

export function warmPluginRuntimeGroups(runtimeSlots: readonly string[]): void {
  for (const group of pluginRuntimeGroupsFor(runtimeSlots)) {
    void group.load().catch(() => {});
  }
}
