import { useMemo } from "react";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import {
  normalizeSidebarSectionOrder,
  type LegacySidebarEntityAnchor,
} from "@bb/client-core";

interface UsePersistedSidebarSectionOrderArgs {
  entitySectionIds: readonly SidebarSectionId[];
  hasPinnedSection: boolean;
  hasThreadsSection?: boolean;
  legacyEntityAnchor: LegacySidebarEntityAnchor;
  storedOrder: readonly string[];
}

export function usePersistedSidebarSectionOrder({
  entitySectionIds,
  hasPinnedSection,
  hasThreadsSection,
  legacyEntityAnchor,
  storedOrder,
}: UsePersistedSidebarSectionOrderArgs): SidebarSectionId[] {
  return useMemo(
    () =>
      normalizeSidebarSectionOrder({
        storedOrder,
        entitySectionIds,
        legacyEntityAnchor,
        hasPinnedSection,
        ...(hasThreadsSection === undefined ? {} : { hasThreadsSection }),
      }),
    [
      entitySectionIds,
      hasPinnedSection,
      hasThreadsSection,
      legacyEntityAnchor,
      storedOrder,
    ],
  );
}
