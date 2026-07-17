import type { ReactNode } from "react";
import { SidebarStickyStack } from "@/components/ui/sidebar.js";
import {
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SidebarSectionRow } from "./SidebarSectionRow";
import { DropPreviewRow } from "./ProjectRow";

export default {
  title: "sidebar/Section row",
};

const noop = () => {};

function activity(
  overrides: Partial<CollapsedChildActivity> = {},
): CollapsedChildActivity {
  return { ...NO_COLLAPSED_CHILD_ACTIVITY, ...overrides };
}

function SidebarStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[460px] min-w-0 rounded-md bg-sidebar p-2 text-sidebar-foreground">
      <SidebarStickyStack>
        <div className="space-y-0.5">{children}</div>
      </SidebarStickyStack>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="expanded" hint="section header, no rolled-up status">
        <SidebarStage>
          <SidebarSectionRow
            name="Work"
            label="Work"
            depth={0}
            activity={activity()}
            isCollapsed={false}
            onToggleCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="collapsed unread"
        hint="collapsed sections show activity"
      >
        <SidebarStage>
          <SidebarSectionRow
            name="Q3"
            label="Work / Q3"
            depth={1}
            activity={activity({ unread: true })}
            isCollapsed
            onToggleCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow label="collapsed working" hint="busy descendant rolls up">
        <SidebarStage>
          <SidebarSectionRow
            name="Build"
            label="Work / Build"
            depth={2}
            activity={activity({ working: true })}
            isCollapsed
            onToggleCollapsed={noop}
            onCreateThread={noop}
            onRename={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="collapsed plan mode"
        hint="hidden plan-mode banner rolls up to the right-aligned plan glyph"
      >
        <SidebarStage>
          <SidebarSectionRow
            name="Planning"
            label="Work / Planning"
            depth={2}
            activity={activity({ working: true, planMode: true })}
            isCollapsed
            onToggleCollapsed={noop}
            onCreateThread={noop}
            onRename={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="collapsed goal"
        hint="hidden active-goal banner rolls up to the right-aligned target glyph"
      >
        <SidebarStage>
          <SidebarSectionRow
            name="Goals"
            label="Work / Goals"
            depth={2}
            activity={activity({ working: true, goal: true })}
            isCollapsed
            onToggleCollapsed={noop}
            onCreateThread={noop}
            onRename={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow label="pending" hint="pending descendant wins the rollup">
        <SidebarStage>
          <SidebarSectionRow
            name="Reviews"
            label="Work / Reviews"
            depth={3}
            activity={activity({ pending: true, unread: true })}
            isCollapsed
            onToggleCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow label="long name" hint="header truncates inside sidebar width">
        <SidebarStage>
          <SidebarSectionRow
            name="Very long customer migration and rollout section"
            label="Clients / Very long customer migration and rollout section"
            depth={1}
            activity={activity()}
            isCollapsed={false}
            onToggleCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="beyond sticky cap"
        hint="deep sections render non-sticky"
      >
        <SidebarStage>
          <SidebarSectionRow
            name="Fifth level"
            label="A / B / C / D / Fifth level"
            depth={5}
            activity={activity()}
            isCollapsed={false}
            onToggleCollapsed={noop}
          />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}

// Drag-into-section affordance: the section highlights as a drop target, and
// after a short hover it springs open with an empty placeholder slot. The
// dragged row keeps its own title (like dragging a queued message), so the
// placeholder stays blank rather than duplicating the title.
export function DragInto() {
  return (
    <StoryCard>
      <StoryRow
        label="drop target"
        hint="section highlights while a thread is dragged over it"
      >
        <SidebarStage>
          <SidebarSectionRow
            name="Work"
            label="Work"
            depth={0}
            activity={activity()}
            isCollapsed={false}
            onToggleCollapsed={noop}
            isDropTargetActive
          />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="empty placeholder"
        hint="after the hover dwell, an empty slot opens inside the section"
      >
        <SidebarStage>
          <SidebarSectionRow
            name="Work"
            label="Work"
            depth={0}
            activity={activity()}
            isCollapsed={false}
            onToggleCollapsed={noop}
            isDropTargetActive
          />
          <DropPreviewRow depth={1} />
        </SidebarStage>
      </StoryRow>
      <StoryRow
        label="loose-list drop"
        hint="dragging a thread out of a section previews the same slot at root depth in the loose Threads list"
      >
        <SidebarStage>
          <DropPreviewRow depth={0} />
        </SidebarStage>
      </StoryRow>
    </StoryCard>
  );
}
