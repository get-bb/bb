import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  sidebarManualSectionOrderAtom,
  sidebarMachineSectionOrderAtom,
  sidebarSectionOrderAtom,
  type SidebarOrganizationMode,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import type { LegacySidebarEntityAnchor } from "@bb/client-core";
import { usePersistedSidebarSectionOrder } from "./usePersistedSidebarSectionOrder";

const MODE_SECTION_ORDER_CONFIG = {
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
} satisfies Record<
  SidebarOrganizationMode,
  {
    atom: typeof sidebarSectionOrderAtom;
    legacyEntityAnchor: LegacySidebarEntityAnchor;
  }
>;

interface UseSidebarModeSectionOrderArgs {
  entitySectionIds: readonly SidebarSectionId[];
  hasThreadsSection?: boolean;
  isReady: boolean;
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
  isReady,
  mode,
  showPinnedSection,
}: UseSidebarModeSectionOrderArgs): UseSidebarModeSectionOrderResult {
  const config = MODE_SECTION_ORDER_CONFIG[mode];
  const [storedOrder, setStoredOrder] = useAtom(config.atom);
  const persistedOrderOptions: Parameters<
    typeof usePersistedSidebarSectionOrder
  >[0] = {
    storedOrder,
    setStoredOrder,
    entitySectionIds,
    legacyEntityAnchor: config.legacyEntityAnchor,
    hasPinnedSection: true,
    isReady,
  };
  if (hasThreadsSection !== undefined) {
    persistedOrderOptions.hasThreadsSection = hasThreadsSection;
  }
  const persistedOrder = usePersistedSidebarSectionOrder(persistedOrderOptions);
  const order = useMemo(
    () =>
      persistedOrder.filter(
        (sectionId) => sectionId !== "pinned" || showPinnedSection,
      ),
    [persistedOrder, showPinnedSection],
  );
  const onOrderChange = useCallback(
    (nextOrder: SidebarSectionId[]) => setStoredOrder(nextOrder),
    [setStoredOrder],
  );

  return { onOrderChange, order, persistedOrder };
}
