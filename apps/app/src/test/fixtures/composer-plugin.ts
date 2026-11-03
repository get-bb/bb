import { resolve } from "node:path";
import {
  collectPluginAppRegistrations,
  isPluginAppDefinition,
} from "@/lib/plugin-app-definition";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import {
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

const COMPOSER_APP_MODULE = resolve(
  __dirname,
  "../../../../../plugins/composer/app.tsx",
);

export const COMPOSER_PLUGIN_ID = "bb--composer";

type ComposerRegistrations = ReturnType<
  typeof collectPluginAppRegistrations
>["composers"];

let registrations: Promise<ComposerRegistrations> | null = null;

function loadComposerRegistrations(): Promise<ComposerRegistrations> {
  registrations ??= (async () => {
    installPluginRuntime();
    const module: { default?: unknown } = await import(
      /* @vite-ignore */ COMPOSER_APP_MODULE
    );
    if (!isPluginAppDefinition(module.default)) {
      throw new Error("composer's app.tsx exports no plugin app definition");
    }
    return collectPluginAppRegistrations(module.default).composers;
  })();
  return registrations;
}

export async function registerComposerPlugin(): Promise<void> {
  setBuiltinPluginIds([COMPOSER_PLUGIN_ID]);
  setPluginSlotRegistrations(
    COMPOSER_PLUGIN_ID,
    makePluginRegistrationSet({ composers: await loadComposerRegistrations() }),
  );
}

export async function composerPluginModule<Module>(
  relativePath: string,
): Promise<Module> {
  installPluginRuntime();
  return (await import(
    /* @vite-ignore */ resolve(
      __dirname,
      "../../../../../plugins/composer/src",
      relativePath,
    )
  )) as Module;
}
