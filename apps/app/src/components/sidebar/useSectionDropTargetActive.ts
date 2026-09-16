import { useChronologicalSectionThreadDnd } from "./SectionThreadDndContext";

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
