import type { ComponentProps, ReactNode } from "react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";
import {
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

const childActivity = (
  overrides: Partial<CollapsedChildActivity> = {},
): CollapsedChildActivity => ({ ...NO_COLLAPSED_CHILD_ACTIVITY, ...overrides });

export default {
  title: "sidebar/Threads",
};

// Caps at the production sidebar max (460px) but shrinks with the parent so
// truncation behavior is visible at any container width.
function SidebarStage({ children }: { children: ReactNode }) {
  return (
    <ThreadActionsProvider>
      <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <div className="space-y-0.5">{children}</div>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </ThreadActionsProvider>
  );
}

const makeThread = (overrides: Partial<ThreadListEntry> = {}) =>
  makeThreadListEntry({ id: "thr_default", ...overrides });

const noop = () => {};

type StoryThreadRowProps = Omit<
  ComponentProps<typeof ThreadRow>,
  "hasComposerDraft"
> & {
  hasComposerDraft?: boolean;
};

function StoryThreadRow({
  hasComposerDraft = false,
  ...props
}: StoryThreadRowProps) {
  return <ThreadRow {...props} hasComposerDraft={hasComposerDraft} />;
}

const defaultOption: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
  isEnvGrouped: false,
};
const childOption: ThreadRowOptions = {
  kind: "default",
  depth: 2,
  isCompact: true,
  isEnvGrouped: false,
};
// Projectless threads are top-level rows (depth 0), flush with project headers.
const projectlessOption: ThreadRowOptions = {
  kind: "default",
  depth: 0,
  isCompact: false,
  isEnvGrouped: false,
};
function parentOption(
  overrides: Partial<Extract<ThreadRowOptions, { kind: "parent" }>> = {},
): ThreadRowOptions {
  return {
    kind: "parent",
    depth: 1,
    isCompact: false,
    isEnvGrouped: false,
    isCollapsed: false,
    childCount: 0,
    childActivity: NO_COLLAPSED_CHILD_ACTIVITY,
    onToggleCollapsed: noop,
    ...overrides,
  };
}

const parentThread = makeThread({
  id: "thr_parent",
  title: "Codex Parent",
  titleFallback: "Codex Parent",
});

const childThread = makeThread({
  id: "thr_child",
  title: "UI And Stories Consolidation",
  titleFallback: "UI And Stories Consolidation",
});

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="idle" hint="quiet thread, title then trailing slot">
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread()}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="projectless"
        hint="no project (Threads section): a normal navigable row at depth 0"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId={PERSONAL_PROJECT_ID}
            thread={makeThread({
              projectId: PERSONAL_PROJECT_ID,
              title: "Sketch launch checklist",
              titleFallback: "Sketch launch checklist",
            })}
            isActive={false}
            options={projectlessOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="projectless (active)"
        hint="the selected projectless thread still shows the active background"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId={PERSONAL_PROJECT_ID}
            thread={makeThread({
              projectId: PERSONAL_PROJECT_ID,
              title: "Sketch launch checklist",
              titleFallback: "Sketch launch checklist",
            })}
            isActive
            options={projectlessOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="active"
        hint="selected thread shows the sidebar-accent background"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread()}
            isActive
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="busy"
        hint="runtime is active — far-right reserved slot shows the busy spinner"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="pending interaction"
        hint="needs attention — far-right reserved slot shows the attention dot"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              status: "active",
              hasPendingInteraction: true,
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="unread done"
        hint="latestAttentionAt > lastReadAt and not busy — far-right reserved slot shows the unread dot"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              lastReadAt: 50,
              latestAttentionAt: 200,
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="unread error"
        hint="status=error and unread — far-right reserved slot shows the destructive unread dot"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              status: "error",
              lastReadAt: 50,
              latestAttentionAt: 200,
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="draft"
        hint="unsubmitted follow-up draft — pencil sits beside the title while the trailing slot stays available"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              title: "Draft follow-up on release checklist",
              titleFallback: "Draft follow-up on release checklist",
            })}
            hasComposerDraft
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="draft + unread"
        hint="draft indicator remains visible next to title; unread dot still owns the status slot"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              title: "Review API migration notes",
              titleFallback: "Review API migration notes",
              lastReadAt: 50,
              latestAttentionAt: 200,
            })}
            hasComposerDraft
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="long title"
        hint="single-line truncate; title attr carries the full string"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              title:
                "Investigate slow tests on recurring CI failures after the timeline pagination v2 merge",
              titleFallback: "Investigate slow tests on recurring CI failures",
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="long title + draft"
        hint="title truncates before the draft icon, so the indicator does not get pushed offscreen"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              title:
                "Write a careful follow-up about the intermittent sidebar grouping bug after the next deploy",
              titleFallback:
                "Write a careful follow-up about the intermittent sidebar grouping bug",
            })}
            hasComposerDraft
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="env: managed worktree"
        hint="leading worktree icon appears before the thread title"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              environmentWorkspaceDisplayKind: "managed-worktree",
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow label="env: unmanaged worktree">
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              environmentWorkspaceDisplayKind: "unmanaged-worktree",
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow label="env: unmanaged worktree">
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              environmentWorkspaceDisplayKind: "unmanaged-worktree",
            })}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="parent, no children"
        hint="no disclosure chevron when there are no children"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={parentThread}
            isActive={false}
            options={parentOption({ childCount: 0 })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="parent, expanded with delegated child"
        hint="parent row above its delegated child — the disclosure chevron sits after the title and rotates open"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={parentThread}
            isActive={false}
            options={parentOption({
              isCollapsed: false,
              childCount: 4,
            })}
          />
          <StoryThreadRow
            projectId="proj_demo"
            thread={childThread}
            isActive={false}
            options={childOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="parent, collapsed"
        hint="chevron points right (default) for a collapsed parent with child rows"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={parentThread}
            isActive={false}
            options={parentOption({
              isCollapsed: true,
              childCount: 4,
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="parent, collapsed — child working"
        hint="trailing slot shows the busy spinner when a hidden child is working"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={parentThread}
            isActive={false}
            options={parentOption({
              isCollapsed: true,
              childCount: 4,
              childActivity: childActivity({ working: true }),
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="parent, collapsed — child needs input"
        hint="trailing slot shows the attention dot when a hidden child is blocked on the user"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={parentThread}
            isActive={false}
            options={parentOption({
              isCollapsed: true,
              childCount: 4,
              childActivity: childActivity({ pending: true }),
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="parent, collapsed — needs input + working"
        hint="attention wins priority: the trailing slot shows the attention dot, not the spinner"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={parentThread}
            isActive={false}
            options={parentOption({
              isCollapsed: true,
              childCount: 4,
              childActivity: childActivity({
                pending: true,
                working: true,
              }),
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="child, busy"
        hint="far-right reserved slot shows the busy spinner"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              ...childThread,
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            })}
            isActive={false}
            options={childOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="child, pending"
        hint="far-right reserved slot shows the attention dot"
      >
        <SidebarStage>
          <StoryThreadRow
            projectId="proj_demo"
            thread={makeThread({
              ...childThread,
              hasPendingInteraction: true,
            })}
            isActive={false}
            options={childOption}
          />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}
