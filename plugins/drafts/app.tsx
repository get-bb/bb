import { toast } from "sonner";
import {
  definePluginApp,
  type ComposerSendMenuItem,
} from "@get-bb/plugin-sdk/app";

const saveDraft: ComposerSendMenuItem = {
  id: "drafts",
  label: "Save draft…",
  icon: "EditFile",
  description: "Keep this message in the queue until you send it manually.",
  disabled: (composer) => composer.isSubmittingBlocked,
  run: async ({ composer }) => {
    if (composer.isEmpty) {
      toast.error("Nothing to save", {
        description: "Type a message first, then save it as a draft.",
      });
      return;
    }
    try {
      await composer.submit({ experimental_data: { kind: "draft" } });
      toast.success("Draft saved");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  },
};

export default definePluginApp((app) => {
  app.composer.customize({
    id: "drafts",
    scopes: ["thread", "new-thread"],
    plusMenu: [saveDraft],
    sendMenu: [saveDraft],
  });
});
