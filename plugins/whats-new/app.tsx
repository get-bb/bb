import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { WhatsNewSidebarSection } from "./sidebar-section.js";
import { WhatsNewUpdatesSection } from "./updates-section.js";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarFooterSection({
    id: "card",
    component: WhatsNewSidebarSection,
  });
  app.slots.settingsSection({
    id: "release-notes",
    experimental_page: "updates",
    component: WhatsNewUpdatesSection,
  });
});
