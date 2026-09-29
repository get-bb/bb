import { definePluginApp } from "@get-bb/plugin-sdk/app";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "create-plugin",
    plusMenu: [
      {
        id: "plugin",
        label: "Plugin",
        icon: "Plug02",
        run: ({ composer }) => composer.insert("Create a new bb plugin that "),
      },
    ],
  });
});
