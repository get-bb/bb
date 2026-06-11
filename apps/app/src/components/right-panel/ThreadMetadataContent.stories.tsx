import {
  ThreadMetadataContent,
  type ThreadMetadataContentProps,
} from "../secondary-panel/ThreadMetadataContent";
import {
  PanelStage,
  baseProps,
  makeThread,
  makeThreadSchedule,
} from "../secondary-panel/ThreadMetadataContent.fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "right-panel/Info",
};

function render(overrides: Partial<ThreadMetadataContentProps>) {
  return (
    <PanelStage>
      <ThreadMetadataContent {...baseProps} {...overrides} />
    </PanelStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="standard"
        hint="canonical state — parent selector + host + env + branch + merge base + clean git status"
      >
        {render({})}
      </StoryRow>
      <StoryRow
        label="standard, child thread"
        hint='thread.parentThreadId set — selector renders the link form'
      >
        {render({
          thread: makeThread({ parentThreadId: "thr_codex_parent" }),
          parentThreadDisplayName: "Codex Parent",
          canAssignToParent: false,
          canTakeOverThread: true,
        })}
      </StoryRow>
      <StoryRow
        label="standard, archived"
        hint="thread.archivedAt set — Archived row + unarchive button render"
      >
        {render({
          thread: makeThread({ archivedAt: 1_700_000_000_000 }),
        })}
      </StoryRow>
      <StoryRow
        label="standard, with schedules"
        hint="threadSchedules present — the Schedules row lists each schedule"
      >
        {render({
          threadSchedules: [
            makeThreadSchedule(),
            makeThreadSchedule({
              id: "sched_cleanup",
              name: "Weekly cleanup",
              enabled: false,
              cron: "0 18 * * 5",
              prompt: "Close stale follow-ups and archive merged threads.",
            }),
          ],
        })}
      </StoryRow>
      <StoryRow
        label="parent thread"
        hint='parent thread with no environment — environment/branch/merge-base hidden'
      >
        {render({
          thread: makeThread({
            title: "Codex Parent",
            titleFallback: "Codex Parent",
            environmentId: null,
          }),
          environment: null,
          workspaceStatus: undefined,
        })}
      </StoryRow>
    </StoryCard>
  );
}
