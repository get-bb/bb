import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { composerActionKinds } from "./composer-actions.js";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "provider-actions",
    scopes: ["thread", "new-thread"],
    plusMenu: composerActionKinds.map((kind) => ({
      id: kind,
      label: kind === "plan" ? "Plan" : "Goal",
      icon: kind === "plan" ? "ListTodo" : "Target",
      visible: (composer) => composer.selection?.providerId === "codex",
      run: ({ composer }) =>
        composer.experimental_applyCommand({
          trigger: "/",
          name: kind,
          trailingText: " ",
        }),
    })),
  });
});
