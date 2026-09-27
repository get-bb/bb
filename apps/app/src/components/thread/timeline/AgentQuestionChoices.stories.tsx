import { useState } from "react";
import { AgentQuestionChoices } from "./AgentQuestionChoices.js";

export default { title: "thread/timeline/Agent Question Choices" };

const message =
  "The branch is green and review is in. Want me to merge it now, or wait for CI on main?";

export const InlineOptions = () => {
  const [draft, setDraft] = useState("");
  return (
    <div className="mx-auto max-w-[640px] rounded-lg bg-background p-8 text-sm text-foreground">
      <div className="space-y-2">
        <p>{message}</p>
        <AgentQuestionChoices text={message} onAddToChat={setDraft} />
      </div>
      <div className="mt-8 rounded-lg border border-border p-3 text-muted-foreground">
        Composer draft: {draft || "Choose an option above"}
      </div>
    </div>
  );
};
