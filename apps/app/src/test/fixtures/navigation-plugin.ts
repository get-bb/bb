import { resolve } from "node:path";
import type { ExperimentalSidebarNavigationRegistration } from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  isPluginAppDefinition,
} from "@/lib/plugin-app-definition";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

const NAVIGATION_APP_MODULE = resolve(
  __dirname,
  "../../../../../plugins/navigation/app.tsx",
);

let registrations: Promise<ExperimentalSidebarNavigationRegistration[]> | null =
  null;

function loadNavigationRegistrations(): Promise<
  ExperimentalSidebarNavigationRegistration[]
> {
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

export async function registerNavigationPlugin(): Promise<void> {
  setPluginSlotRegistrations(
    "navigation",
    makePluginRegistrationSet({
      experimentalSidebarNavigations: await loadNavigationRegistrations(),
    }),
  );
}
