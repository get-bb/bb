import {
  ThreadMetadataContent,
  type ThreadMetadataContentProps,
} from "./ThreadMetadataContent";
import {
  PanelStage,
  baseProps,
  makePullRequest,
  makeThread,
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
          pullRequest: makePullRequest(),
        })}
      </StoryRow>
      <StoryRow
        label="standard, child thread"
        hint="thread.parentThreadId set — selector renders the link form"
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
        label="parent thread"
        hint="parent thread with no environment — environment/branch/merge-base hidden"
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
