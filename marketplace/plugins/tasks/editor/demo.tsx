// Temporary visual-verification demo for the hello screen. A later worker
// rebuilds app.tsx; this stays self-contained so it can simply be dropped.
import { useState } from "react";
import { TasksEditor } from "./tasks-editor.js";

const SEED_MARKDOWN = `## Ship the editor

Adapted from the **Docs** plugin with *markdown* as the ~~storage~~ canonical format, \`tiptap-markdown\` round-trips it.

- [x] Copy the TipTap stack
- [ ] Wire the @mention popover
- [ ] Blocked on [TSK-42](bbtask://TSK-42) review

\`\`\`ts
const editor = new Editor({ extensions });
\`\`\`

> Type @ to mention a task, or [ ] for a checklist.`;

const DEMO_ITEMS = [
  { id: "tsk_1", key: "TSK-42", title: "Review editor markdown round-trip" },
  { id: "tsk_2", key: "TSK-7", title: "Design task detail panel" },
  { id: "tsk_3", key: "TSK-19", title: "Comment threads on tasks" },
];

export function TasksEditorDemo() {
  const [markdown, setMarkdown] = useState(SEED_MARKDOWN);
  return (
    <div className="w-full max-w-lg space-y-4">
      <section className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">
          Editor demo · doc variant
        </p>
        <TasksEditor
          value={markdown}
          onChange={setMarkdown}
          placeholder="Add a description…"
          mentionItems={(query) =>
            Promise.resolve(
              DEMO_ITEMS.filter((item) =>
                `${item.key} ${item.title}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ),
            )
          }
        />
      </section>
      <section className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">
          Read-only · comment variant
        </p>
        <TasksEditor
          value={markdown}
          onChange={() => undefined}
          readOnly
          variant="comment"
        />
      </section>
    </div>
  );
}
