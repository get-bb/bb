import { useCallback, useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  sidebarManualSectionOrderAtom,
  sidebarMachineSectionOrderAtom,
  sidebarSectionOrderAtom,
  sidebarIsGroupRecencySortActiveAtom,
  sidebarSortGroupsByRecencyAtom,
  type SidebarOrganizationMode,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import {
  normalizeSidebarSectionOrder,
  type LegacySidebarEntityAnchor,
} from "@bb/client-core";

const MODE_SECTION_ORDER_CONFIG: Record<
  SidebarOrganizationMode,
  {
    atom: typeof sidebarSectionOrderAtom;
    legacyEntityAnchor: LegacySidebarEntityAnchor;
  }
> = {
  project: {
    atom: sidebarSectionOrderAtom,
    legacyEntityAnchor: "projects",
  },
  chronological: {
    atom: sidebarManualSectionOrderAtom,
    legacyEntityAnchor: "sections",
  },
  machine: {
    atom: sidebarMachineSectionOrderAtom,
    legacyEntityAnchor: "machines",
  },
};

interface UseSidebarModeSectionOrderArgs {
  entitySectionIds: readonly SidebarSectionId[];
  hasThreadsSection?: boolean;
  mode: SidebarOrganizationMode;
  showPinnedSection: boolean;
}

interface UseSidebarModeSectionOrderResult {
  onOrderChange: (order: SidebarSectionId[]) => void;
  order: SidebarSectionId[];
  persistedOrder: SidebarSectionId[];
}

export function useSidebarModeSectionOrder({
  entitySectionIds,
  hasThreadsSection,
  mode,
  showPinnedSection,
}: UseSidebarModeSectionOrderArgs): UseSidebarModeSectionOrderResult {
  const config = MODE_SECTION_ORDER_CONFIG[mode];
  const [storedOrder, setStoredOrder] = useAtom(config.atom);
  const sortGroupsByRecency = useAtomValue(sidebarIsGroupRecencySortActiveAtom);
  const setSortGroupsByRecency = useSetAtom(sidebarSortGroupsByRecencyAtom);
  const persistedOrder = useMemo(() => {
    const normalizedOrder = normalizeSidebarSectionOrder({
      storedOrder,
      entitySectionIds,
      legacyEntityAnchor: config.legacyEntityAnchor,
      hasPinnedSection: true,
      ...(hasThreadsSection === undefined ? {} : { hasThreadsSection }),
    });
    if (!sortGroupsByRecency) return normalizedOrder;
    const entityIds = new Set(entitySectionIds);
    let nextEntityIndex = 0;
    return normalizedOrder.map((id) =>
      entityIds.has(id) ? entitySectionIds[nextEntityIndex++]! : id,
    );
  }, [
    config.legacyEntityAnchor,
    entitySectionIds,
    hasThreadsSection,
    storedOrder,
    sortGroupsByRecency,
  ]);
  const order = useMemo(
    () =>
      persistedOrder.filter(
        (sectionId) => sectionId !== "pinned" || showPinnedSection,
      ),
    [persistedOrder, showPinnedSection],
  );
  const onOrderChange = useCallback(
    (nextOrder: SidebarSectionId[]) => {
      setStoredOrder(nextOrder);
      setSortGroupsByRecency(false);
    },
    [setStoredOrder, setSortGroupsByRecency],
  );

  return { onOrderChange, order, persistedOrder };
}
