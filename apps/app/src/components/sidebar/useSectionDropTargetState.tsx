import { useChronologicalSectionThreadDnd } from "./SectionThreadDndContext";
import {
  SIDEBAR_SECTION_DROP_TARGET_CLASS,
  SIDEBAR_SECTION_DROP_TARGET_UNCHANGED_CLASS,
} from "./sidebarRowClasses";
import type { SectionThreadDndState } from "./useSectionThreadDnd";

export type SidebarSectionDropState = "active" | "unchanged";

const SECTION_DROP_TARGET_STATE_CLASS: Record<SidebarSectionDropState, string> =
  {
    active: SIDEBAR_SECTION_DROP_TARGET_CLASS,
    unchanged: SIDEBAR_SECTION_DROP_TARGET_UNCHANGED_CLASS,
  };

export function resolveSectionDropTargetState(
  sectionDnd: SectionThreadDndState | null,
  parentKey: string | undefined,
): SidebarSectionDropState | null {
  if (parentKey === undefined || !sectionDnd) return null;
  if (sectionDnd.activeThread === null) return null;
  if (sectionDnd.dragOverParentKey === parentKey) return "active";
  if (sectionDnd.unchangedParentKey === parentKey) return "unchanged";
  return null;
}

export function useSectionDropTargetState(
  parentKey: string | undefined,
): SidebarSectionDropState | null {
  return resolveSectionDropTargetState(
    useChronologicalSectionThreadDnd(),
    parentKey,
  );
}

export function SectionDropTargetOverlay({
  state,
}: {
  state: SidebarSectionDropState;
}) {
  return (
    <span
      aria-hidden="true"
      data-sidebar-drop-target-overlay=""
      className={SECTION_DROP_TARGET_STATE_CLASS[state]}
    />
  );
}
