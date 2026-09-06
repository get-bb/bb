import { useMemo, useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { QuestionForm } from "@bb/shared-ui/question-form";
import {
  ASK_USER_QUESTION_RENDERER_ID,
  interactionPayloadSchema,
} from "./src/contracts.js";

function AskUserQuestionInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => interactionPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [busy, setBusy] = useState(false);
  const handleCancel = () => {
    void cancel().catch(() => {});
  };
  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This question could not be displayed.
        </p>
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <QuestionForm
      key={interaction.id}
      questions={parsed.data.questions}
      disabled={busy}
      cancelDisabled={busy}
      onSubmit={(answers) => {
        setBusy(true);
        void submit({ answers })
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
      onCancel={handleCancel}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: ASK_USER_QUESTION_RENDERER_ID,
    component: AskUserQuestionInteraction,
  });
});
