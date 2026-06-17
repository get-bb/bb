import { useState } from "react";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadTodoCard } from "./ThreadTodoCard";

export default {
  title: "promptbox/banner/Todo Card",
};

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const mixedTodos: ThreadTimelinePendingTodos = {
  sourceSeq: 0,
  updatedAt: 0,
  items: [
    {
      id: "todo:1",
      text: "Read the planning doc",
      status: "completed",
    },
    {
      id: "todo:2",
      text: "Build initial banner shell",
      status: "completed",
    },
    {
      id: "todo:3",
      text: "Wire pendingTodos from the timeline projection",
      status: "in_progress",
    },
    {
      id: "todo:4",
      text: "Surface pendingTodos in `bb thread show` and `bb status`",
      status: "pending",
    },
    {
      id: "todo:5",
      text: "Tighten GET /threads/:id with requirePublicProject",
      status: "pending",
    },
  ],
};

const pendingOnlyTodos: ThreadTimelinePendingTodos = {
  sourceSeq: 1,
  updatedAt: 0,
  items: [
    {
      id: "todo:pending:1",
      text: "Create focused Storybook coverage",
      status: "pending",
    },
    {
      id: "todo:pending:2",
      text: "Wire the production prompt stack",
      status: "pending",
    },
  ],
};

function ToggleableTodoCard({
  pendingTodos,
  initiallyExpanded = false,
}: {
  pendingTodos: ThreadTimelinePendingTodos;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <ThreadTodoCard
      pendingTodos={pendingTodos}
      isExpanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    />
  );
}

function FauxComposer() {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className="pb-3 text-sm text-subtle-foreground">
        Reply to the agent...
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          opus
        </span>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="prompt stack"
        hint="collapsed header shows compact N/M progress; click to expand"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ToggleableTodoCard pendingTodos={mixedTodos} />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow
        label="expanded"
        hint="in-progress, pending, and completed items sorted by status"
      >
        <Stage>
          <ToggleableTodoCard pendingTodos={mixedTodos} initiallyExpanded />
        </Stage>
      </StoryRow>
      <StoryRow label="pending only" hint="summary starts at 0/N complete">
        <Stage>
          <ToggleableTodoCard
            pendingTodos={pendingOnlyTodos}
            initiallyExpanded
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
