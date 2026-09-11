import { useCallback } from "react";
import { useStore } from "jotai";
import type { NavigateOptions } from "react-router-dom";
import type { DraftContentInput } from "@bb/server-contract";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { createNewThreadDraft } from "@/lib/drafts/resource-runtime";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { openDraftInSplit } from "@/lib/split-layout/openDraftInSplit";

export function useOpenNewThreadDraft() {
  const store = useStore();
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();
  const [projectId] = useRootComposeProjectId();
  return useCallback(
    (content: DraftContentInput = {}, options?: NavigateOptions) => {
      const draftId = createNewThreadDraft({ projectId, ...content });
      openDraftInSplit({
        store,
        navigate: (route, splitOptions) =>
          navigate(route, { ...splitOptions, ...options }),
        draftId,
        split: "replace",
        isCompact,
      });
      return draftId;
    },
    [isCompact, navigate, projectId, store],
  );
}
