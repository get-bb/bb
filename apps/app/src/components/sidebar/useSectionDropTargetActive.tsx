import { useChronologicalSectionThreadDnd } from "./SectionThreadDndContext";
import { SIDEBAR_SECTION_DROP_TARGET_CLASS } from "./sidebarRowClasses";

export function useSectionDropTargetActive(
  parentKey: string | undefined,
): boolean {
  const sectionDnd = useChronologicalSectionThreadDnd();
  if (parentKey === undefined || !sectionDnd) return false;
  return (
    sectionDnd.activeThread !== null &&
    sectionDnd.dragOverParentKey === parentKey
  );
}

export function SectionDropTargetOverlay() {
  return (
    <span
      aria-hidden="true"
      data-sidebar-drop-target-overlay=""
      className={SIDEBAR_SECTION_DROP_TARGET_CLASS}
    />
  );
}
