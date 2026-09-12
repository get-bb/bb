import { toast } from "sonner";
import { definePluginApp } from "@get-bb/plugin-sdk/app";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "drafts",
    scopes: ["thread", "new-thread"],
    plusMenu: [
      {
        id: "drafts",
        label: "Save draft…",
        icon: "EditFile",
        description:
          "Keep this message in the queue until you send it manually.",
        disabled: (view) => view.draft.isEmpty || view.run.isSubmitting,
        run: async ({ composer, view }) => {
          try {
            await composer.experimental_submit();
            toast.success("Draft saved");
          } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
          if (view.draft.isEmpty) {
            toast.error("Nothing to save", {
              description: "Type a message first, then save it as a draft.",
            });
          }
        },
      },
    ],
  });
});
