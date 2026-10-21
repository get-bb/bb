import { useCallback } from "react";

export function setCollapsedSectionIds<Section extends string>(
  ids: readonly Section[],
  sectionId: Section,
  collapsed: boolean,
): Section[] {
  return [
    ...ids.filter((id) => id !== sectionId),
    ...(collapsed ? [sectionId] : []),
  ];
}

export function useSectionCollapse<Section extends string>(
  sectionId: Section,
  collapsedIds: readonly string[],
  onChange: (sectionId: Section, collapsed: boolean) => void,
) {
  const setCollapsed = useCallback(
    (collapsed: boolean) => onChange(sectionId, collapsed),
    [sectionId, onChange],
  );
  return { collapsed: collapsedIds.includes(sectionId), setCollapsed };
}
