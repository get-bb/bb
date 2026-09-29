import type { ComposerCustomization } from "@get-bb/plugin-sdk/app";

export const composerCustomization: ComposerCustomization = {
  id: "create-automation",
  plusMenu: [
    {
      id: "automation",
      label: "Automation",
      icon: "Repeat",
      run: ({ composer }) =>
        composer.experimental_applyCommand({
          trigger: "/",
          name: "automation",
          trailingText: " ",
        }),
    },
  ],
};
