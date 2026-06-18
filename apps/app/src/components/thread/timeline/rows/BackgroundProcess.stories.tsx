import type { TimelineRow } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { backgroundCommandRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/BackgroundProcess",
};

function TimelineStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const baseProps = {
  threadRuntimeDisplayStatus: "idle" as const,
  workspaceRootPath: undefined,
};

// ---------------------------------------------------------------------------
// A backgrounded shell command (Claude Code Bash run_in_background). It reuses
// the workflow work row with taskType "local_bash": no agent/phase tree, just
// description + lifecycle status + the provider's terminal summary (which
// embeds the exit code). The actual command line renders in the separate
// command-execution row that launched it.
// ---------------------------------------------------------------------------

const baseArgs = {
  threadId: "thr_fixture",
  turnId: "turn-1",
  sourceSeqStart: 2,
  sourceSeqEnd: 2,
  startedAt: 1780540127710,
  createdAt: 1780540131011,
  itemId: "task:bmn5wv33k",
  description: "Count ticks from 1 to 6 with 1 second delays",
};

const running: TimelineRow = backgroundCommandRow({
  ...baseArgs,
  id: "thr_fixture:bg:task:bmn5wv33k:running",
  status: "pending",
  taskStatus: "running",
  summary: null,
  durationMs: null,
});

const completed: TimelineRow = backgroundCommandRow({
  ...baseArgs,
  id: "thr_fixture:bg:task:bmn5wv33k:completed",
  status: "completed",
  taskStatus: "completed",
  summary:
    'Background command "Count ticks from 1 to 6 with 1 second delays" completed (exit code 0)',
  durationMs: 12_000,
});

const failed: TimelineRow = backgroundCommandRow({
  ...baseArgs,
  id: "thr_fixture:bg:task:bmn5wv33k:failed",
  description: "Build the project",
  status: "error",
  taskStatus: "failed",
  summary: 'Background command "Build the project" failed (exit code 1)',
  durationMs: 8_000,
});

const interrupted: TimelineRow = backgroundCommandRow({
  ...baseArgs,
  id: "thr_fixture:bg:task:bmn5wv33k:interrupted",
  description: "Tail the dev server log",
  status: "interrupted",
  taskStatus: "stopped",
  summary: null,
  durationMs: 30_000,
});

// Several background commands at once: each backgroundTask item folds into its
// own row (keyed by item id), so concurrent commands simply stack — two still
// running plus one already finished.
const concurrent: TimelineRow[] = [
  backgroundCommandRow({
    id: "thr_fixture:bg:dev-server:running",
    description: "Run the dev server",
    status: "pending",
    taskStatus: "running",
    summary: null,
    startedAt: Date.now() - 14_000,
  }),
  backgroundCommandRow({
    id: "thr_fixture:bg:watch-tests:running",
    description: "Watch and re-run tests",
    status: "pending",
    taskStatus: "running",
    summary: null,
    startedAt: Date.now() - 6_000,
  }),
  backgroundCommandRow({
    id: "thr_fixture:bg:build:completed",
    description: "Build the project",
    status: "completed",
    taskStatus: "completed",
    summary: 'Background command "Build the project" completed (exit code 0)',
    durationMs: 42_000,
  }),
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="running"
        hint="backgrounded command still running: shimmering title, no outcome yet"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            threadRuntimeDisplayStatus="active"
            timelineRows={[running]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="completed" hint="terminal summary embeds the exit code">
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            initialExpanded={new Set([completed.id])}
            timelineRows={[completed]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="failed" hint="non-zero exit reads as a failed command">
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            initialExpanded={new Set([failed.id])}
            timelineRows={[failed]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="interrupted"
        hint="session ended while the command was still running"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[interrupted]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="multiple"
        hint="concurrent background commands each get their own row (2 running + 1 done)"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            threadRuntimeDisplayStatus="active"
            initialExpanded={new Set(["thr_fixture:bg:build:completed"])}
            timelineRows={concurrent}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}
