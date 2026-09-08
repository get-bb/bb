import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  systemRow,
  fileReadRow,
  fileChangeRow,
  conversationRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "../ThreadTimelineRows";
import { TimelineReasoningExpansionProvider } from "../TimelineReasoningExpansion";
import { TimelineWorkingIndicator } from "../TimelineWorkingIndicator";

export default { title: "thread/timeline/rows/Reasoning" };

const text =
  "The live indicator and completed thought should use the same layout. Keep the disclosure expanded while changing the label and adding the duration.";
const thought = systemRow({
  id: "reasoning-1",
  systemKind: "operation",
  operationKind: "reasoning",
  title: "Thought for 12s",
  detail: text,
  status: "completed",
  startedAt: 1_000,
  completedAt: 13_000,
});
const baseProps = {
  threadRuntimeDisplayStatus: "idle" as const,
  workspaceRootPath: undefined,
};

export function Lifecycle() {
  const [phase, setPhase] = useState<"empty" | "thinking" | "completed">(
    "empty",
  );
  const [cycle, setCycle] = useState(0);
  return (
    <div className="mx-auto max-w-2xl p-8 space-y-6">
      <div>
        <h1 className="text-lg font-medium">Reasoning lifecycle</h1>
        <p className="text-sm text-muted-foreground">
          Add text, expand the thought, then complete it. Expansion carries
          over.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setPhase("thinking")}
          disabled={phase !== "empty"}
        >
          Add thinking text
        </Button>
        <Button
          onClick={() => setPhase("completed")}
          disabled={phase !== "thinking"}
        >
          Complete thought
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setCycle(cycle + 1);
            setPhase("empty");
          }}
        >
          Next thought
        </Button>
      </div>
      <div className="rounded-lg border border-border p-4">
        <TimelineReasoningExpansionProvider>
          {phase === "completed" ? (
            <ThreadTimelineRows
              {...baseProps}
              timelineRows={[{ ...thought, id: `reasoning-${cycle}` }]}
            />
          ) : (
            <TimelineWorkingIndicator
              key={cycle}
              isThinking
              reasoningId={`reasoning-${cycle}`}
              details={phase === "thinking" ? text : ""}
            />
          )}
        </TimelineReasoningExpansionProvider>
      </div>
    </div>
  );
}

export function Completed() {
  return (
    <div className="mx-auto max-w-2xl p-8 space-y-6">
      <ThreadTimelineRows
        {...baseProps}
        timelineRows={[thought]}
        initialExpanded={new Set([thought.id])}
      />
      <ThreadTimelineRows
        {...baseProps}
        timelineRows={[
          { ...thought, id: "interrupted", status: "interrupted" },
        ]}
      />
    </div>
  );
}

export function Grouped() {
  const [closed, setClosed] = useState(false);
  const rows = [
    { ...thought, id: "before", detail: "Inspect the implementation first." },
    fileReadRow({ id: "read-a", path: "src/app.ts", seq: 2 }),
    { ...thought, id: "between", detail: "Check the helper before editing." },
    fileReadRow({ id: "read-b", path: "src/helper.ts", seq: 4 }),
    {
      ...thought,
      id: "before-edit",
      detail: "Keep the existing public contract.",
    },
    fileChangeRow({ id: "edit", path: "src/app.ts", seq: 6 }),
  ];
  return (
    <div className="mx-auto max-w-2xl p-8 space-y-6">
      <Button onClick={() => setClosed(!closed)}>
        {closed ? "Show running turn" : "Complete step"}
      </Button>
      <TimelineReasoningExpansionProvider>
        <ThreadTimelineRows
          {...baseProps}
          timelineRows={
            closed
              ? [
                  ...rows,
                  conversationRow({
                    role: "assistant",
                    text: "Updated the implementation.",
                    seq: 7,
                  }),
                ]
              : rows
          }
        />
      </TimelineReasoningExpansionProvider>
    </div>
  );
}
