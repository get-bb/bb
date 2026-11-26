import { definePluginApp, experimental_lazy } from "@get-bb/plugin-sdk/app";

const AccountPoolSettings = experimental_lazy(() =>
  import("./settings-section.js").then((module) => ({
    default: module.AccountPoolSettings,
  })),
);

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "accounts",
    component: AccountPoolSettings,
  });
});
