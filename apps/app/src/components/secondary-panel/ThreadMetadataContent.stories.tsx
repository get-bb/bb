import {
  ThreadMetadataContent,
  type ThreadMetadataContentProps,
} from "./ThreadMetadataContent";
import {
  PanelStage,
  baseProps,
  makeThread,
  makeThreadSchedule,
} from "./ThreadMetadataContent.fixtures";
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
        hint="canonical state — parent + env + worktree path + branch + merge base + pull request + clean git status"
      >
        {render({
          pullRequest: {
            number: 128,
            title: "Show the branch's GitHub pull request in the Info tab",
            state: "open",
            url: "https://github.com/acme/bb/pull/128",
          },
        })}
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

// The pull-request row in the full Info panel, so each state is visible in its
// real position alongside Branch / Merge base / Git status.
export function PullRequest() {
  const url = "https://github.com/acme/bb/pull/128";
  const title = "Show the branch's GitHub pull request in the Info tab";
  return (
    <StoryCard>
      <StoryRow
        label="open"
        hint="the PR row sits with the Branch / Merge base / Git status group"
      >
        {render({ pullRequest: { number: 128, title, state: "open", url } })}
      </StoryRow>
      <StoryRow label="draft">
        {render({ pullRequest: { number: 128, title, state: "draft", url } })}
      </StoryRow>
      <StoryRow label="merged">
        {render({ pullRequest: { number: 128, title, state: "merged", url } })}
      </StoryRow>
      <StoryRow label="closed">
        {render({ pullRequest: { number: 128, title, state: "closed", url } })}
      </StoryRow>
      <StoryRow label="no PR" hint="row omitted entirely when there is no PR">
        {render({ pullRequest: null })}
      </StoryRow>
    </StoryCard>
  );
}
