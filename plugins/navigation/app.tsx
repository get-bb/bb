import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Navigation } from "./app/Navigation.js";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "navigation",
    title: "Navigation",
    description:
      "New thread, Search, Plugins, Skills, and plugin panels as sidebar rows.",
    component: Navigation,
  });
});
