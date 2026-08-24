import { useMemo, type ReactNode } from "react";
import { useEnvironment } from "@/data/environments";
import { useThread } from "@/data/threads";
import { WorkspacePanelProvider } from "./PanelProvider";
import type { PanelScope } from "./panel-model";

/**
 * The thread detail screen's workspace panel: scope from the thread record
 * and its environment (both already cached by the screen's bootstrap), the
 * device-local state under the thread id, and the server strip of the same
 * thread. The Diff entry appears once the environment is known to be a git
 * repo (web `resolveGitDiffTabStatus`); until the thread and environment
 * settle the persisted strip is left untouched.
 */
export function ThreadWorkspacePanelProvider({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const threadQuery = useThread(threadId);
  const thread = threadQuery.data;
  const environmentId = thread?.environmentId ?? null;
  const environmentQuery = useEnvironment(environmentId);
  const environment = environmentQuery.data;
  const projectId = thread?.projectId ?? null;
  const hostId = environment?.hostId ?? null;
  const scope = useMemo<PanelScope>(
    () => ({ kind: "thread", threadId, projectId, environmentId, hostId }),
    [environmentId, hostId, projectId, threadId],
  );
  const scopeResolved =
    thread !== undefined &&
    (environmentId === null ||
      environment !== undefined ||
      environmentQuery.isError);
  return (
    <WorkspacePanelProvider
      scope={scope}
      panelStateId={threadId}
      syncThreadId={threadId}
      showInfo
      showDiff={environment?.isGitRepo === true}
      scopeResolved={scopeResolved}
    >
      {children}
    </WorkspacePanelProvider>
  );
}
