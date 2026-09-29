import codexApp from "../../../../../plugins/provider-codex/app";
import claudeApp from "../../../../../plugins/provider-claude-code/app";
import { composerCustomization as automations } from "../../../../../plugins/automations/composer";
import guideApp from "../../../../../plugins/bb-guide/app";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";

export function registerComposerMenuPlugins() {
  for (const [id, definition] of [
    ["provider-codex", codexApp],
    ["provider-claude-code", claudeApp],
    ["bb-guide", guideApp],
  ] as const) {
    setPluginSlotRegistrations(
      id,
      makePluginRegistrationSet(collectPluginAppRegistrations(definition)),
    );
  }
  setPluginSlotRegistrations(
    "automations",
    makePluginRegistrationSet({
      composerCustomizations: [automations],
    }),
  );
}
