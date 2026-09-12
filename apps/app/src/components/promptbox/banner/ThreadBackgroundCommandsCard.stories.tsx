import { useState } from "react";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { ThreadBackgroundCommandsCard } from "./ThreadBackgroundCommandsCard";
import { backgroundCommandRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { FauxComposer, ResponsiveStage } from "./banner-story-stages";

export default {
  title: "promptbox/banner/Background Commands Card",
};

const runningCommand = (
  args: Parameters<typeof backgroundCommandRow>[0],
): TimelineWorkflowWorkRow =>
  backgroundCommandRow({
    status: "pending",
    taskStatus: "running",
    summary: null,
    ...args,
  });

const single: TimelineWorkflowWorkRow[] = [
  runningCommand({
    id: "thr_fixture:bg:tail-dev-log",
    description: "Poll all CI runs for batching head until completion",
    startedAt: Date.now() - 8_000,
  }),
];

const many: TimelineWorkflowWorkRow[] = [
  runningCommand({
    id: "thr_fixture:bg:dev-server",
    description: "Run the dev server",
    startedAt: Date.now() - 26_000,
  }),
  runningCommand({
    id: "thr_fixture:bg:watch-tests",
    description: "Watch and re-run tests",
    startedAt: Date.now() - 12_000,
  }),
  runningCommand({
    id: "thr_fixture:bg:tail-log",
    description: "Tail the dev server log",
    startedAt: Date.now() - 4_000,
  }),
];

function ExpandableCard({
  commands,
  startExpanded = false,
}: {
  commands: TimelineWorkflowWorkRow[];
  startExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  return (
    <div className="flex flex-col gap-2">
      <ThreadBackgroundCommandsCard
        commands={commands}
        isExpanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      <FauxComposer />
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="single"
        hint="compact: summarized and expandable; wide: detailed single line"
      >
        <ResponsiveStage>
          <ExpandableCard commands={single} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="multiple (collapsed)"
        hint='most recent command + "+N more"; click to expand'
      >
        <ResponsiveStage>
          <ExpandableCard commands={many} />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="multiple (expanded)"
        hint="expanded: the other running commands listed below the primary"
      >
        <ResponsiveStage>
          <ExpandableCard commands={many} startExpanded />
        </ResponsiveStage>
      </StoryRow>
    </StoryCard>
  );
}
