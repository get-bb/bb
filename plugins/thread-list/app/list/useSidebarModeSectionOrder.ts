import { useCallback, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import { reorderStoredOrder } from "../model/stored-order.js";
import {
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarMachineSectionOrderAtom,
  sidebarSectionOrderAtom,
} from "../preferences/atoms.js";
import type { OrganizationMode as SidebarOrganizationMode } from "../../shared/preferences.js";
import {
  buildSidebarEntitySectionId,
  normalizeSidebarSectionOrder,
  type LegacySidebarEntityAnchor,
  type SidebarSectionId,
} from "@bb/client-core";

const MODE_SECTION_ORDER_CONFIG: Record<
  SidebarOrganizationMode,
  {
    atom: typeof sidebarSectionOrderAtom;
    entityKind: "project" | "section" | "machine";
    legacyEntityAnchor: LegacySidebarEntityAnchor;
  }
> = {
  project: {
    atom: sidebarSectionOrderAtom,
    entityKind: "project",
    legacyEntityAnchor: "projects",
  },
  chronological: {
    atom: sidebarManualSectionOrderAtom,
    entityKind: "section",
    legacyEntityAnchor: "sections",
  },
  machine: {
    atom: sidebarMachineSectionOrderAtom,
    entityKind: "machine",
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
  const hiddenGroups = useAtomValue(sidebarHiddenGroupsAtom);
  const hiddenGroupIds = useMemo(
    () => new Set<string>(hiddenGroups),
    [hiddenGroups],
  );
  const persistedOrder = useMemo(
    () =>
      normalizeSidebarSectionOrder({
        storedOrder,
        entitySectionIds,
        legacyEntityAnchor: config.legacyEntityAnchor,
        hasPinnedSection: true,
        ...(hasThreadsSection === undefined ? {} : { hasThreadsSection }),
      }),
    [
      config.legacyEntityAnchor,
      entitySectionIds,
      hasThreadsSection,
      storedOrder,
    ],
  );
  const order = useMemo(
    () =>
      persistedOrder.filter(
        (sectionId) =>
          (sectionId !== "pinned" || showPinnedSection) &&
          !hiddenGroupIds.has(sectionId),
      ),
    [hiddenGroupIds, persistedOrder, showPinnedSection],
  );
  const onOrderChange = useCallback(
    (nextOrder: SidebarSectionId[]) => {
      const nextIds = new Set(nextOrder);
      setStoredOrder((current) => {
        const storedEntityIds = current
          .filter((id) => id.startsWith(`${config.entityKind}:`))
          .map((id) =>
            buildSidebarEntitySectionId(
              config.entityKind,
              id.slice(config.entityKind.length + 1),
            ),
          );
        const fullOrder = normalizeSidebarSectionOrder({
          storedOrder: current,
          entitySectionIds: [...entitySectionIds, ...storedEntityIds],
          legacyEntityAnchor: config.legacyEntityAnchor,
          hasPinnedSection: true,
          hasThreadsSection:
            hasThreadsSection !== false || current.includes("threads"),
        });
        return (
          reorderStoredOrder({
            order: fullOrder,
            visibleIds: fullOrder.filter((id) => nextIds.has(id)),
            nextVisibleIds: nextOrder,
          }) ?? current
        );
      });
    },
    [config, entitySectionIds, hasThreadsSection, setStoredOrder],
  );
  return { onOrderChange, order, persistedOrder };
}
