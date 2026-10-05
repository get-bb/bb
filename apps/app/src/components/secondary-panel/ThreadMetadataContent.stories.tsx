import { useState } from "react";
import type { WorkspaceFile } from "@bb/server-contract";
import {
  ThreadMetadataContent,
  type ThreadMetadataContentProps,
} from "./ThreadMetadataContent";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";
import {
  PanelStage,
  baseProps,
  makePullRequest,
  makeThread,
  makeWorkspaceStatus,
  STORY_AHEAD_COMMITS,
  STORY_DIRTY_WORKING_TREE,
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

const STORAGE_FILES: WorkspaceFile[] = [
  "Attachments/screenshot-before.png",
  "Attachments/screenshot-after.png",
  "notes/plan.md",
  "qa-log.txt",
].map((path) => ({ path, name: path.slice(path.lastIndexOf("/") + 1) }));

function WorkInProgressPanel() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const controller = useThreadStorageBrowser({
    files: STORAGE_FILES,
    onSelectPath: setSelectedPath,
    selectedPath,
  });
  return render({
    pullRequest: makePullRequest(),
    workspaceStatus: makeWorkspaceStatus({
      workingTree: {
        ...STORY_DIRTY_WORKING_TREE,
        state: "dirty_and_committed_unmerged",
      },
      mergeBase: {
        mergeBaseBranch: "main",
        baseRef: "main",
        aheadCount: STORY_AHEAD_COMMITS.length,
        behindCount: 0,
        hasCommittedUnmergedChanges: true,
        commits: STORY_AHEAD_COMMITS,
        insertions: 0,
        deletions: 0,
        lineStatsComplete: true,
        files: [],
      },
    }),
    onCommitClick: () => {},
    onOpenChangedFile: () => {},
    storage: { controller, filesError: null },
  });
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
        label="work in progress"
        hint="commits ahead of the merge base, uncommitted changes, and thread storage"
      >
        <WorkInProgressPanel />
      </StoryRow>
      <StoryRow
        label="standard, child thread"
        hint="thread.parentThreadId set — selector renders the link form"
      >
        {render({
          thread: makeThread({ parentThreadId: "thr_codex_parent" }),
          parentThreadProjectId: null,
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
