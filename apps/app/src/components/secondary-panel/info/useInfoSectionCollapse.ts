import { useCallback } from "react";
import { useAtom } from "jotai";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { InfoSectionCollapse } from "./info-list";

const collapsedInfoSectionIdsAtom = createSyncedPreferenceAtom(
  "infoPanel.collapsedSections",
);

export function useInfoSectionCollapse(sectionId: string): InfoSectionCollapse {
  const [collapsedIds, setCollapsedIds] = useAtom(collapsedInfoSectionIdsAtom);
  const collapsed = collapsedIds.includes(sectionId);
  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      setCollapsedIds((ids) => {
        const without = ids.filter((id) => id !== sectionId);
        return nextCollapsed ? [...without, sectionId] : without;
      });
    },
    [sectionId, setCollapsedIds],
  );
  return { collapsed, setCollapsed };
}
