import { memo, type ReactNode } from "react";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import {
  type CollapsibleSidebarSectionId,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import {
  TopLevelSidebarSection,
  type TopLevelSidebarSectionProps,
} from "./TopLevelSidebarSection";
import { useSidebarSortable } from "./sortableMotion";
import {
  CHRONOLOGICAL_CONTAINER_ID,
  type CollapsedChildActivity,
} from "@bb/client-core";
import { PINNED_THREAD_PARENT_KEY } from "./useSectionThreadDnd";
import type { ThreadSplitIndicatorTarget } from "./paneContentSplitIndicator";

interface SortableSidebarSectionProps extends TopLevelSidebarSectionProps {
  disabled: boolean;
  id: SidebarSectionId;
}

export interface BuiltInSidebarSectionOptions {
  activity?: CollapsedChildActivity;
  actions?: ReactNode;
  actionsOpen?: boolean;
  collapsedThreads?: readonly ThreadSplitIndicatorTarget[];
  content: ReactNode;
  label: string;
}

interface BuiltInSidebarSectionProps extends BuiltInSidebarSectionOptions {
  consumeClickSuppression?: ConsumeDragClickSuppression;
  disabled: boolean;
  id: CollapsibleSidebarSectionId;
  isCollapsed: boolean;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
}

const BUILT_IN_SECTION_DROP_PARENT_KEY: Record<
  CollapsibleSidebarSectionId,
  string
> = {
  pinned: PINNED_THREAD_PARENT_KEY,
  threads: CHRONOLOGICAL_CONTAINER_ID,
};

export type BuiltInSidebarSectionOptionsById = Record<
  CollapsibleSidebarSectionId,
  BuiltInSidebarSectionOptions
>;

interface RenderBuiltInSidebarSectionArgs {
  collapsedSectionIds: ReadonlySet<CollapsibleSidebarSectionId>;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  disabled: boolean;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
  sectionId: SidebarSectionId;
  sections: BuiltInSidebarSectionOptionsById;
  showPinnedSection: boolean;
}

export const SortableSidebarSection = memo(function SortableSidebarSection({
  id,
  disabled,
  ...props
}: SortableSidebarSectionProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id,
    disabled,
  });

  return (
    <TopLevelSidebarSection
      {...props}
      dragBindings={props.labelEditor ? undefined : dragBindings}
      sectionRef={setNodeRef}
      sectionStyle={style}
    />
  );
});

function BuiltInSidebarSection({
  actions,
  actionsOpen,
  activity,
  collapsedThreads,
  consumeClickSuppression,
  content,
  disabled,
  id,
  isCollapsed,
  label,
  onToggleCollapsed,
}: BuiltInSidebarSectionProps) {
  return (
    <SortableSidebarSection
      id={id}
      label={label}
      stickyHeader={id !== "pinned"}
      disabled={disabled}
      actions={actions}
      actionsOpen={actionsOpen}
      collapsedActivity={activity}
      collapsedThreads={collapsedThreads}
      actionsMobileAlways
      collapseControl={{
        isCollapsed,
        onToggleCollapsed: () => onToggleCollapsed(id),
      }}
      consumeClickSuppression={consumeClickSuppression}
      dropParentKey={BUILT_IN_SECTION_DROP_PARENT_KEY[id]}
    >
      {content}
    </SortableSidebarSection>
  );
}

export function renderBuiltInSidebarSection({
  collapsedSectionIds,
  consumeClickSuppression,
  disabled,
  onToggleCollapsed,
  sectionId,
  sections,
  showPinnedSection,
}: RenderBuiltInSidebarSectionArgs): ReactNode | undefined {
  if (sectionId !== "pinned" && sectionId !== "threads") {
    return undefined;
  }
  if (sectionId === "pinned" && !showPinnedSection) return undefined;
  return (
    <BuiltInSidebarSection
      {...sections[sectionId]}
      key={sectionId}
      id={sectionId}
      disabled={disabled}
      isCollapsed={collapsedSectionIds.has(sectionId)}
      onToggleCollapsed={onToggleCollapsed}
      consumeClickSuppression={consumeClickSuppression}
    />
  );
}
