import { useEffect, useMemo } from "react";
import type {
  PluginThreadActionDataInput,
  PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { useGitWorkspaces, useShowCommitButton } from "../queries.js";
import {
  closeCommitDialogUnlessShown,
  openCommitDialog,
} from "./commit-store.js";

export interface CommitActionData {
  showCommitButton: boolean;
  environmentIdsWithChanges: ReadonlySet<string>;
}

function useCommitActionData({
  threadIds,
  experimental_threads: threads,
}: PluginThreadActionDataInput): CommitActionData {
  const showCommitButton = useShowCommitButton();
  const environmentIdsKey = [
    ...new Set(threads.flatMap((thread) => thread.environment?.id ?? [])),
  ].join("\n");
  const environmentIds = useMemo(
    () => (environmentIdsKey === "" ? [] : environmentIdsKey.split("\n")),
    [environmentIdsKey],
  );
  const workspaces = useGitWorkspaces(showCommitButton ? environmentIds : []);
  useEffect(() => {
    closeCommitDialogUnlessShown(threadIds);
  }, [threadIds]);
  return useMemo(
    () => ({
      showCommitButton,
      environmentIdsWithChanges: new Set(
        [...workspaces]
          .filter(
            ([, workspace]) => workspace.workingTree.hasUncommittedChanges,
          )
          .map(([environmentId]) => environmentId),
      ),
    }),
    [showCommitButton, workspaces],
  );
}

export const commitThreadAction: PluginThreadActionRegistration<CommitActionData> =
  {
    id: "commit",
    placement: "header",
    group: "git",
    title: "Commit",
    icon: "GitBranch",
    useData: useCommitActionData,
    item: ({ thread, data }) => {
      const environment = thread.environment;
      if (
        !data.showCommitButton ||
        thread.archivedAt !== null ||
        environment === null ||
        !data.environmentIdsWithChanges.has(environment.id)
      ) {
        return null;
      }
      return {
        label: "Commit",
        icon: "GitBranch",
        run: () =>
          openCommitDialog({
            threadId: thread.id,
            environmentId: environment.id,
          }),
      };
    },
  };
