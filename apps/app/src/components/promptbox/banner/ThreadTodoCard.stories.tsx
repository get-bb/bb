import { useState } from "react";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ResponsiveStage } from "./banner-story-stages";
import { ThreadTodoCard } from "./ThreadTodoCard";

export default {
  title: "promptbox/banner/Todo Card",
};

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

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="prompt stack"
        hint="collapsed header shows compact N/M progress; click to expand"
      >
        <ResponsiveStage>
          <ToggleableTodoCard pendingTodos={mixedTodos} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="expanded"
        hint="in-progress, pending, and completed items sorted by status"
      >
        <ResponsiveStage>
          <ToggleableTodoCard pendingTodos={mixedTodos} initiallyExpanded />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="pending only" hint="summary starts at 0/N complete">
        <ResponsiveStage>
          <ToggleableTodoCard
            pendingTodos={pendingOnlyTodos}
            initiallyExpanded
          />
        </ResponsiveStage>
      </StoryRow>
    </StoryCard>
  );
}
