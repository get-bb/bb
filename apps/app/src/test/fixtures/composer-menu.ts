import { composerCustomization as automations } from "../../../../../plugins/automations/composer";
import guideApp from "../../../../../plugins/bb-guide/app";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

export function registerComposerMenuPlugins() {
  setPluginSlotRegistrations(
    "bb-guide",
    makePluginRegistrationSet(collectPluginAppRegistrations(guideApp)),
  );
  setPluginSlotRegistrations(
    "automations",
    makePluginRegistrationSet({
      composerCustomizations: [automations],
    }),
  );
}
