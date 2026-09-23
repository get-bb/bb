import type { ExperimentalSidebarNavigationRegistration } from "@get-bb/plugin-sdk";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

let registrations: Promise<ExperimentalSidebarNavigationRegistration[]> | null =
  null;

function loadNavigationRegistrations(): Promise<
  ExperimentalSidebarNavigationRegistration[]
> {
  registrations ??= (async () => {
    installPluginRuntime();
    const module = await import("../../../../../plugins/navigation/app");
    return collectPluginAppRegistrations(module.default)
      .experimentalSidebarNavigations;
  })();
  return registrations;
}

export async function registerNavigationPlugin(): Promise<void> {
  setPluginSlotRegistrations(
    "navigation",
    makePluginRegistrationSet({
      experimentalSidebarNavigations: await loadNavigationRegistrations(),
    }),
  );
}
