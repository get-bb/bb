import { resolve } from "node:path";
import {
  collectPluginAppRegistrations,
  isPluginAppDefinition,
} from "@/lib/plugin-app-definition";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import {
  getPluginSlotSnapshot,
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

const NAVIGATION_APP_MODULE = resolve(
  __dirname,
  "../../../../../plugins/navigation/app.tsx",
);

type NavigationRegistrations = ReturnType<
  typeof collectPluginAppRegistrations
>["experimentalSidebarNavigations"];

let registrations: Promise<NavigationRegistrations> | null = null;

function loadNavigationRegistrations(): Promise<NavigationRegistrations> {
  registrations ??= (async () => {
    installPluginRuntime();
    const module: { default?: unknown } = await import(
      /* @vite-ignore */ NAVIGATION_APP_MODULE
    );
    if (!isPluginAppDefinition(module.default)) {
      throw new Error("navigation's app.tsx exports no plugin app definition");
    }
    return collectPluginAppRegistrations(module.default)
      .experimentalSidebarNavigations;
  })();
  return registrations;
}

const NAVIGATION_PLUGIN_ID = "navigation";

export async function registerNavigationPlugin(): Promise<void> {
  setBuiltinPluginIds([NAVIGATION_PLUGIN_ID]);
  setPluginSlotRegistrations(
    NAVIGATION_PLUGIN_ID,
    makePluginRegistrationSet({
      experimentalSidebarNavigations: await loadNavigationRegistrations(),
    }),
  );
}

export function bundledNavigationSlot(
  id: "rail" | "top-list",
): ExperimentalSidebarNavigationSlot {
  const slot = getPluginSlotSnapshot().experimentalSidebarNavigations.find(
    (candidate) =>
      candidate.pluginId === NAVIGATION_PLUGIN_ID && candidate.id === id,
  );
  if (slot === undefined) {
    throw new Error(
      `navigation/${id} is not registered; call registerNavigationPlugin first`,
    );
  }
  return slot;
}
