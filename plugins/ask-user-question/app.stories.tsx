import { useEffect } from "react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";

installTestPluginRuntime();
const { default: questionApp } = await import("./app");

export default { title: "plugins/Question form" };

export function CompactQuestion() {
  useEffect(() => {
    setPluginSlotRegistrations(
      "ask-user-question",
      makePluginRegistrationSet({
        pendingInteractions:
          collectPluginAppRegistrations(questionApp).pendingInteractions,
      }),
    );
    return () => removePluginSlotRegistrations("ask-user-question");
  }, []);
  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-3xl flex-col justify-end p-4">
      <PluginPendingInteractionComposer
        interaction={{
          id: "question-demo",
          threadId: "thread-demo",
          createdAt: 1,
        }}
        dismissal="cancel"
        request={{
          pluginId: "ask-user-question",
          rendererId: "ask-user-question",
          title: "Which implementation path should I take?",
          data: {
            questions: [
              {
                id: "path",
                shortLabel: "Path",
                prompt: "Which implementation path should I take?",
                multiSelect: false,
                allowFreeText: true,
                options: [
                  {
                    value: "small",
                    label: "Small patch",
                    description: "Fix the active issue with minimal churn.",
                  },
                  {
                    value: "complete",
                    label: "Complete flow",
                    description: "Update the UI, tests, and stories together.",
                  },
                ],
              },
              {
                id: "notes",
                shortLabel: "Notes",
                prompt: "Anything else I should account for?",
                multiSelect: false,
                allowFreeText: true,
                options: [],
              },
            ],
          },
        }}
      />
    </div>
  );
}
