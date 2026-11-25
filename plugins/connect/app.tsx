import { definePluginApp, experimental_lazy } from "@get-bb/plugin-sdk/app";

const loadSections = () => import("./sections.js");

const ConnectSettingsSection = experimental_lazy(() =>
  loadSections().then((module) => ({
    default: module.ConnectSettingsSection,
  })),
);

const MobilePairingSection = experimental_lazy(() =>
  loadSections().then((module) => ({
    default: module.MobilePairingSection,
  })),
);

const ConnectSetupGuideSection = experimental_lazy(() =>
  loadSections().then((module) => ({
    default: module.ConnectSetupGuideSection,
  })),
);

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "remote-access",
    description:
      "Use this bb from any device, anywhere — powered by getbb.app.",
    component: ConnectSettingsSection,
  });
  app.slots.settingsSection({
    id: "mobile-pairing",
    experimental_page: "mobile",
    component: MobilePairingSection,
  });
  app.slots.internal_DO_NOT_USE_setupGuideSection({
    id: "remote-access",
    component: ConnectSetupGuideSection,
  });
});
