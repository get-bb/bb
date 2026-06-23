import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import {
  PROJECT_IDS,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { SidebarStickyStack } from "@/components/ui/sidebar.js";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  ChronologicalThreadTree,
  ProjectThreadTree,
  type ProjectThreadListState,
} from "./ProjectRow";
import { compareStandardThreads } from "./projectThreadGroups";

export default {
  title: "sidebar/Folder grouping",
};

const noop = () => {};
const PROJECT_ID = PROJECT_IDS.bb;

function makeThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    projectId: PROJECT_ID,
    titleFallback: overrides.title ?? "Story thread",
    ...overrides,
  });
}

const folderThreads: ThreadListEntry[] = [
  makeThread({
    id: "thr_work_plan",
    title: "Plan",
    folderPath: "Work/Q3",
    latestAttentionAt: 90,
    createdAt: 90,
  }),
  makeThread({
    id: "thr_work_notes",
    title: "Notes",
    folderPath: "Work/Q3",
    latestAttentionAt: 80,
    createdAt: 80,
  }),
  makeThread({
    id: "thr_work_parent",
    title: "Kickoff",
    folderPath: "Work/Q4",
    latestAttentionAt: 70,
    createdAt: 70,
  }),
  makeThread({
    id: "thr_work_child",
    parentThreadId: "thr_work_parent",
    title: "Child path stays literal / not a folder",
    folderPath: "Ignored/Child",
    latestAttentionAt: 65,
    createdAt: 65,
  }),
  makeThread({
    id: "thr_personal_plan",
    title: "Plan",
    folderPath: "Personal/Q3",
    latestAttentionAt: 60,
    createdAt: 60,
  }),
  makeThread({
    id: "thr_standalone",
    title: "Standalone follow-up",
    latestAttentionAt: 50,
    createdAt: 50,
  }),
  makeThread({
    id: "thr_env_a",
    title: "Daemon",
    folderPath: "Work/Build",
    environmentId: "env_story_folder",
    environmentName: "Folder build",
    environmentBranchName: "bb/sidebar-folders",
    environmentWorkspaceDisplayKind: "managed-worktree",
    latestAttentionAt: 40,
    createdAt: 40,
  }),
  makeThread({
    id: "thr_env_b",
    title: "Stories",
    folderPath: "Work/Build",
    environmentId: "env_story_folder",
    environmentName: "Folder build",
    environmentBranchName: "bb/sidebar-folders",
    environmentWorkspaceDisplayKind: "managed-worktree",
    hasPendingInteraction: true,
    latestAttentionAt: 30,
    createdAt: 30,
  }),
];

function SidebarStage({ children }: { children: ReactNode }) {
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
          <SidebarStickyStack>{children}</SidebarStickyStack>
        </div>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

function projectTree(
  threads: readonly ThreadListEntry[],
): ProjectThreadListState {
  return { status: "ready", threads: [...threads] };
}

function ProjectTree({ threads }: { threads: readonly ThreadListEntry[] }) {
  return (
    <ProjectThreadTree
      projectId={PROJECT_ID}
      threadListState={projectTree(threads)}
      compareThreads={compareStandardThreads}
      collapsedThreadIds={new Set()}
      collapsedEnvironmentIds={new Set()}
      variant="section"
      onToggleThreadCollapsed={noop}
      onToggleEnvironmentCollapsed={noop}
    />
  );
}

export function ProjectFolders() {
  return (
    <StoryCard>
      <StoryRow label="project" hint="stored folderPath groups project threads">
        <SidebarStage>
          <ProjectTree threads={folderThreads} />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ChronologicalFolders() {
  return (
    <StoryCard>
      <StoryRow
        label="all threads"
        hint="stored folderPath groups matching paths across projects"
      >
        <SidebarStage>
          <ChronologicalThreadTree
            threadListState={projectTree(folderThreads)}
            compareThreads={compareStandardThreads}
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={new Set()}
            onToggleThreadCollapsed={noop}
            onToggleEnvironmentCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}
