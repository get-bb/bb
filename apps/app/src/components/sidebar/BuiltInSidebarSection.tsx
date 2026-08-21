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
import type { CollapsedChildActivity } from "@bb/client-core";
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
  isDropTargetActive?: boolean;
  label: string;
}

interface BuiltInSidebarSectionProps extends BuiltInSidebarSectionOptions {
  consumeClickSuppression?: ConsumeDragClickSuppression;
  disabled: boolean;
  id: CollapsibleSidebarSectionId;
  isCollapsed: boolean;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
}

export type BuiltInSidebarSectionNodes = Record<
  CollapsibleSidebarSectionId,
  ReactNode
>;

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
      dragBindings={dragBindings}
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
  isDropTargetActive,
  isCollapsed,
  label,
  onToggleCollapsed,
}: BuiltInSidebarSectionProps) {
  return (
    <SortableSidebarSection
      id={id}
      label={label}
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
      isDropTargetActive={isDropTargetActive}
    >
      {content}
    </SortableSidebarSection>
  );
}

export function getBuiltInSidebarSectionNode(
  sectionId: SidebarSectionId,
  sections: BuiltInSidebarSectionNodes,
): ReactNode | undefined {
  if (sectionId !== "pinned" && sectionId !== "threads") {
    return undefined;
  }
  return sections[sectionId];
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
