import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
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

const defaultOption: ThreadRowOptions = {
  kind: "default",
  indent: "project-child",
};
const managedChildOption: ThreadRowOptions = {
  kind: "managed-child",
  indent: "nested-child",
};
function managerOption(
  overrides: Partial<Extract<ThreadRowOptions, { kind: "manager" }>> = {},
): ThreadRowOptions {
  return {
    kind: "manager",
    indent: "project-child",
    isCollapsed: false,
    nestedChildCount: 0,
    managedChildActivity: NO_COLLAPSED_CHILD_ACTIVITY,
    onToggleCollapsed: noop,
    ...overrides,
  };
}

const managerThread = makeThread({
  id: "thr_manager",
  type: "manager",
  title: "Codex Manager",
  titleFallback: "Codex Manager",
});

const childThread = makeThread({
  id: "thr_child",
  title: "UI And Stories Consolidation",
  titleFallback: "UI And Stories Consolidation",
});

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="idle" hint="quiet thread, no leading icon">
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={makeThread()}
            isActive={false}
            options={defaultOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="active"
        hint="selected thread shows the sidebar-border background"
      >
        <SidebarStage>
          <ThreadRow
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
          <ThreadRow
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
          <ThreadRow
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
          <ThreadRow
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
        label="long title"
        hint="single-line truncate; title attr carries the full string"
      >
        <SidebarStage>
          <ThreadRow
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
        label="env: managed worktree"
        hint="trailing icon hint for the workspace display kind"
      >
        <SidebarStage>
          <ThreadRow
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
          <ThreadRow
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
          <ThreadRow
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
        label="manager, no children"
        hint="leading user icon, no chevron"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={managerThread}
            isActive={false}
            options={managerOption({ nestedChildCount: 0 })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="manager, expanded with child"
        hint="manager row above its child — user icon swaps to a rotated chevron on hover, child text aligns with the manager title"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={managerThread}
            isActive={false}
            options={managerOption({
              isCollapsed: false,
              nestedChildCount: 4,
            })}
          />
          <ThreadRow
            projectId="proj_demo"
            thread={childThread}
            isActive={false}
            options={managedChildOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="manager, collapsed"
        hint="chevron points right (default) for a collapsed manager with hidden children"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={managerThread}
            isActive={false}
            options={managerOption({
              isCollapsed: true,
              nestedChildCount: 4,
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="manager, collapsed — child working"
        hint="trailing slot shows the busy spinner when a hidden child is working"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={managerThread}
            isActive={false}
            options={managerOption({
              isCollapsed: true,
              nestedChildCount: 4,
              managedChildActivity: childActivity({ working: true }),
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="manager, collapsed — child needs input"
        hint="trailing slot shows the attention dot when a hidden child is blocked on the user"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={managerThread}
            isActive={false}
            options={managerOption({
              isCollapsed: true,
              nestedChildCount: 4,
              managedChildActivity: childActivity({ pending: true }),
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="manager, collapsed — needs input + working"
        hint="attention wins priority: the trailing slot shows the attention dot, not the spinner"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={managerThread}
            isActive={false}
            options={managerOption({
              isCollapsed: true,
              nestedChildCount: 4,
              managedChildActivity: childActivity({
                pending: true,
                working: true,
              }),
            })}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="managed child, busy"
        hint="far-right reserved slot shows the busy spinner"
      >
        <SidebarStage>
          <ThreadRow
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
            options={managedChildOption}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="managed child, pending"
        hint="far-right reserved slot shows the attention dot"
      >
        <SidebarStage>
          <ThreadRow
            projectId="proj_demo"
            thread={makeThread({
              ...childThread,
              hasPendingInteraction: true,
            })}
            isActive={false}
            options={managedChildOption}
          />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}
