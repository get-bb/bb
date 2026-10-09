import { useMemo, useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { QuestionForm } from "@/components/ui/question-form";
import {
  CODEX_ASYNC_QUESTION_RENDERER_ID,
  asyncQuestionPayloadSchema,
  buildAsyncQuestionFormQuestions,
} from "./src/async-question-form.js";

function AsyncQuestionInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => asyncQuestionPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [busy, setBusy] = useState(false);
  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This question could not be displayed.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void cancel().catch(() => {})}
        >
          Dismiss
        </Button>
      </div>
    );
  }
  return (
    <QuestionForm
      key={interaction.id}
      draftKey={`${interaction.threadId}:${interaction.id}`}
      questions={buildAsyncQuestionFormQuestions(parsed.data.questions)}
      disabled={busy}
      cancelDisabled={busy}
      onSubmit={(answers) => {
        setBusy(true);
        return submit({ answers }).finally(() => setBusy(false));
      }}
      onCancel={cancel}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: CODEX_ASYNC_QUESTION_RENDERER_ID,
    component: AsyncQuestionInteraction,
  });
});
