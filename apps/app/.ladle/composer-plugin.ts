import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import {
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { loadPluginAppDefinition } from "./plugin-app-module";

const COMPOSER_PLUGIN_ID = "bb--composer";

const composerApp = await loadPluginAppDefinition(
  import.meta.glob<unknown>("../../../plugins/composer/app.tsx"),
);

export function registerStoryComposerPlugin(): void {
  setBuiltinPluginIds([COMPOSER_PLUGIN_ID]);
  setPluginSlotRegistrations(
    COMPOSER_PLUGIN_ID,
    makePluginRegistrationSet({
      composers: collectPluginAppRegistrations(composerApp).composers,
    }),
  );
}

registerStoryComposerPlugin();
