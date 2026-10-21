import {
  useSectionCollapse,
  setCollapsedSectionIds,
} from "@bb/shared-ui/hooks/use-section-collapse";
import { useCallback } from "react";
import { useAtom } from "jotai";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { InfoSectionCollapse } from "@/components/secondary-panel/info/info-list";

const collapsedInfoSectionIdsAtom = createSyncedPreferenceAtom(
  "infoPanel.collapsedSections",
);

export function useInfoSectionCollapse(sectionId: string): InfoSectionCollapse {
  const [collapsedIds, setCollapsedIds] = useAtom(collapsedInfoSectionIdsAtom);
  const onChange = useCallback(
    (id: string, collapsed: boolean) => {
      setCollapsedIds((ids) => setCollapsedSectionIds(ids, id, collapsed));
    },
    [setCollapsedIds],
  );
  return useSectionCollapse(sectionId, collapsedIds, onChange);
}
