import { createContext, useCallback, useContext } from "react";
import { useAtom } from "jotai";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { InfoSectionCollapse } from "./info-list";

const collapsedInfoSectionIdsAtom = createSyncedPreferenceAtom(
  "infoPanel.collapsedSections",
);

export const InfoSectionCollapseIdContext = createContext<string | null>(null);

export function useScopedInfoSectionCollapse():
  | InfoSectionCollapse
  | undefined {
  const sectionId = useContext(InfoSectionCollapseIdContext);
  const [collapsedIds, setCollapsedIds] = useAtom(collapsedInfoSectionIdsAtom);
  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      if (sectionId === null) return;
      setCollapsedIds((ids) => {
        const without = ids.filter((id) => id !== sectionId);
        return nextCollapsed ? [...without, sectionId] : without;
      });
    },
    [sectionId, setCollapsedIds],
  );
  if (sectionId === null) return undefined;
  return { collapsed: collapsedIds.includes(sectionId), setCollapsed };
}
