import { useEffect, useMemo, useState } from "react";
import {
  useSdk,
  type PluginBrowserBbSdk,
  type PluginThreadActionDataInput,
  type PluginThreadActionRegistration,
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

type ThreadEnvironmentIds = ReadonlyMap<string, string | null>;

function useThreadEnvironmentIds(
  sdk: PluginBrowserBbSdk,
  threadIds: readonly string[],
): ThreadEnvironmentIds {
  const [environmentIds, setEnvironmentIds] = useState<ThreadEnvironmentIds>(
    () => new Map(),
  );
  useEffect(() => {
    let current = true;
    const load = (threadId: string) => {
      sdk.threads.get({ threadId }).then(
        (thread) => {
          if (!current) return;
          setEnvironmentIds((previous) => {
            if (previous.get(threadId) === thread.environmentId)
              return previous;
            const next = new Map(previous);
            next.set(threadId, thread.environmentId);
            return next;
          });
        },
        () => undefined,
      );
    };
    for (const threadId of threadIds) load(threadId);
    const unsubscribes = threadIds.map((threadId) =>
      sdk.subscribe({
        event: "thread:changed",
        threadId,
        callback: (event) => {
          if (event.changes.includes("environment-changed")) load(threadId);
        },
      }),
    );
    const connection = sdk.subscribe({
      event: "realtime:connection",
      callback: (event) => {
        if (event.state !== "connected" || !event.reconnected) return;
        for (const threadId of threadIds) load(threadId);
      },
    });
    return () => {
      current = false;
      for (const unsubscribe of unsubscribes) unsubscribe();
      connection();
    };
  }, [sdk, threadIds]);
  return environmentIds;
}

function useCommitActionData({
  threadIds,
}: PluginThreadActionDataInput): CommitActionData {
  const sdk = useSdk();
  const showCommitButton = useShowCommitButton();
  const threadEnvironmentIds = useThreadEnvironmentIds(sdk, threadIds);
  const environmentIds = useMemo(
    () => [
      ...new Set(
        threadIds.flatMap((threadId) => {
          const environmentId = threadEnvironmentIds.get(threadId);
          return environmentId == null ? [] : [environmentId];
        }),
      ),
    ],
    [threadEnvironmentIds, threadIds],
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
