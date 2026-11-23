import { createPickMapPreferenceAtom } from "@/lib/plugin-replacement-preference";

export const FILE_OPENERS_TITLE = "File openers";

export const MARKDOWN_SETTINGS_TITLE = "Markdown";

export const codeFencePicksAtom = createPickMapPreferenceAtom(
  "codeFence.byLanguage",
);

export const messageDirectivePicksAtom = createPickMapPreferenceAtom(
  "messageDirective.byName",
);
