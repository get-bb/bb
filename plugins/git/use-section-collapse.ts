import {
  useSectionCollapse,
  setCollapsedSectionIds,
} from "@bb/shared-ui/hooks/use-section-collapse";
import { useCallback } from "react";
import {
  experimental_useRpcQuery,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { gitRpcContract } from "./contract.js";

export function useGitSectionCollapse(
  sectionId: "commits" | "uncommittedChanges",
) {
  const query = experimental_useRpcQuery({
    contract: gitRpcContract,
    method: "collapsedSections",
    input: null,
  });
  const mutation = experimental_useRpcMutation({
    contract: gitRpcContract,
    method: "setSectionCollapsed",
    optimistic({ sectionId, collapsed }, cache) {
      cache.update("collapsedSections", null, (ids) =>
        setCollapsedSectionIds(ids, sectionId, collapsed),
      );
    },
  });
  const mutate = mutation.mutate;
  const onChange = useCallback(
    (sectionId: "commits" | "uncommittedChanges", collapsed: boolean) => {
      void mutate({ sectionId, collapsed }).catch(() =>
        toast.error("Failed to save section preference"),
      );
    },
    [mutate],
  );
  return useSectionCollapse(sectionId, query.data ?? [], onChange);
}
