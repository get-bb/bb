import { createPickMapPreferenceAtom } from "@/lib/plugin-replacement-preference";

export const PLUGIN_CHOICES_TITLE = "Plugin choices";

export const codeFencePicksAtom = createPickMapPreferenceAtom(
  "codeFence.byLanguage",
);

export const messageDirectivePicksAtom = createPickMapPreferenceAtom(
  "messageDirective.byName",
);
