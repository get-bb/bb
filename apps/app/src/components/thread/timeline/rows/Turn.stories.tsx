import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";
import {
  fileChangeActiveThinkingDelete,
  fileChangeAssistantStream,
  fileChangeIndex,
  fileChangeTimelineService,
  fileChangeToViewMessages,
} from "./projection-refactor-story-rows";

export default {
  title: "thread/timeline/rows/Turn",
};

function TimelineStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container/page mx-auto w-full max-w-[760px]">
      {children}
    </div>
  );
}

const baseProps = {
  threadRuntimeDisplayStatus: "idle" as const,
  workspaceRootPath: undefined,
};

const assistantOpener: TimelineRow = conversationRow({
  id: "thr_zeb7z9afmw:assistant-text:35343",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35343,
  sourceSeqEnd: 35343,
  startedAt: 1777337120500,
  createdAt: 1777337121200,
  role: "assistant",
  text: "I’m moving the active-thinking state into the main projection pass so we stop reconstructing it from events afterward. After that I’ll remove the old parent-specific branch and stop recomputing active-thinking inside the turn-summary-details loop.",
  attachments: null,
});

const commandSedAssistantStream: TimelineRow = commandRow({
  id: "thr_zeb7z9afmw:command:call_YrdwFQNVKDsaBvwc98oQ9qP4",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35347,
  sourceSeqEnd: 35347,
  startedAt: 1777337121300,
  createdAt: 1777337121800,
  status: "completed",
  callId: "call_YrdwFQNVKDsaBvwc98oQ9qP4",
  command:
    "/bin/zsh -lc \"sed -n '1,260p' packages/core-ui/src/assistant-stream-projection.ts\"",
  cwd: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb",
  source: null,
  output: "",
  exitCode: 0,
  approvalStatus: null,
  activityIntents: [
    {
      type: "read",
      command: "sed",
      name: "assistant-stream-projection.ts",
      path: "packages/core-ui/src/assistant-stream-projection.ts",
    },
  ],
  durationMs: 500,
});

const commandSedTimelineHelpers: TimelineRow = commandRow({
  id: "thr_zeb7z9afmw:command:call_XF7ZEgp9XUvdErfdDi9zKDX6",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35349,
  sourceSeqEnd: 35349,
  startedAt: 1777337121900,
  createdAt: 1777337122300,
  status: "completed",
  callId: "call_XF7ZEgp9XUvdErfdDi9zKDX6",
  command:
    "/bin/zsh -lc \"sed -n '1,200p' packages/core-ui/src/timeline-message-helpers.ts\"",
  cwd: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb",
  source: null,
  output: "",
  exitCode: 0,
  approvalStatus: null,
  activityIntents: [
    {
      type: "read",
      command: "sed",
      name: "timeline-message-helpers.ts",
      path: "packages/core-ui/src/timeline-message-helpers.ts",
    },
  ],
  durationMs: 400,
});

const commandSedVisibleText: TimelineRow = commandRow({
  id: "thr_zeb7z9afmw:command:call_AcUMKIrd6rllJWdPYubsSTjL",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35351,
  sourceSeqEnd: 35351,
  startedAt: 1777337122400,
  createdAt: 1777337122800,
  status: "completed",
  callId: "call_AcUMKIrd6rllJWdPYubsSTjL",
  command:
    "/bin/zsh -lc \"sed -n '1,220p' packages/core-ui/src/visible-text-buffer.ts\"",
  cwd: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb",
  source: null,
  output: "",
  exitCode: 0,
  approvalStatus: null,
  activityIntents: [
    {
      type: "read",
      command: "sed",
      name: "visible-text-buffer.ts",
      path: "packages/core-ui/src/visible-text-buffer.ts",
    },
  ],
  durationMs: 400,
});

const assistantPlanning: TimelineRow = conversationRow({
  id: "thr_zeb7z9afmw:assistant-text:35381",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35381,
  sourceSeqEnd: 35381,
  startedAt: 1777337122900,
  createdAt: 1777337123000,
  role: "assistant",
  text: "I’ve got the shape of the refactor now. The key is to make the flat projection pass return both durable messages and ephemeral `activeThinking`, then use that one result everywhere instead of rebuilding lifecycle from raw events afterward.",
  attachments: null,
});

const turnChildren: TimelineRow[] = [
  assistantOpener,
  commandSedAssistantStream,
  commandSedTimelineHelpers,
  commandSedVisibleText,
  assistantPlanning,
  fileChangeAssistantStream,
  fileChangeIndex,
  fileChangeTimelineService,
  fileChangeActiveThinkingDelete,
  fileChangeToViewMessages,
];

interface BuildTurnRowArgs {
  status: TimelineTurnRow["status"];
  completedAt: number | null;
  startedAt: number;
  createdAt: number;
}

function buildTurnRow({
  status,
  completedAt,
  startedAt,
  createdAt,
}: BuildTurnRowArgs): TimelineTurnRow {
  return turnRow({
    id: "thr_zeb7z9afmw:019dd185-ef12-7d50-aa48-47882e9c8aaf:turn",
    threadId: "thr_zeb7z9afmw",
    turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
    sourceSeqStart: 35289,
    sourceSeqEnd: 35671,
    startedAt,
    createdAt,
    status,
    summaryCount: turnChildren.length,
    durationMs: completedAt === null ? null : completedAt - startedAt,
    children: turnChildren,
  });
}

const completedTurnRow = buildTurnRow({
  status: "completed",
  completedAt: 1777337131200,
  startedAt: 1777337120000,
  createdAt: 1777337131200,
});

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="collapsed"
        hint="completed turn — header only, click to expand"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[completedTurnRow]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="expanded" hint="turn body open to its child rows">
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            initialExpanded={new Set([completedTurnRow.id])}
            timelineRows={[completedTurnRow]}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}
