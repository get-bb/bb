import {
  definePluginApp,
  experimental_lazy,
  experimental_THREAD_INFO_SECTION_GROUPS,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { composerCustomization } from "./composer";
import { PANEL_PATH, parseSubPath, useAutomation } from "./automation-route.js";

const loadPanel = () => import("./panel.js");

const AutomationsPanel = experimental_lazy(() =>
  loadPanel().then((module) => ({ default: module.AutomationsPanel })),
);

const AutomationsThreadInfoSection = experimental_lazy(() =>
  loadPanel().then((module) => ({
    default: module.AutomationsThreadInfoSection,
  })),
);

function useAutomationsPageTitle({ subPath }: PluginNavPanelProps) {
  const parsed = parseSubPath(subPath);
  const { automation } = useAutomation(parsed?.route ?? null);
  return parsed
    ? {
        breadcrumbs: [
          { label: "Installed", to: "/plugins/automations/automations" },
          { label: automation?.name ?? parsed.route.automationId },
        ],
      }
    : { title: subPath === "browse" ? "Browse" : "Installed" };
}

export default definePluginApp((app) => {
  app.composer.customize(composerCustomization);
  app.slots.navPanel({
    id: "automations",
    title: "Automations",
    icon: "Repeat",
    path: PANEL_PATH,
    component: AutomationsPanel,
    experimental_usePageTitle: useAutomationsPageTitle,
  });
  app.slots.experimental_threadInfoSection({
    id: "automations",
    group: experimental_THREAD_INFO_SECTION_GROUPS.related,
    order: 0,
    component: AutomationsThreadInfoSection,
  });
});
