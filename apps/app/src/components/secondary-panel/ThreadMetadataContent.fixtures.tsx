import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import {
  makeEnvironment,
  makeThread,
  makeThreadListEntry,
  makeWorkspaceStatus,
} from "../../../.ladle/story-fixtures";
import type { ThreadMetadataContentProps } from "./ThreadMetadataContent";

// Re-export the shared builders so per-row stories in this folder can import
// from one place.
export {
  makeEnvironment,
  makeThread,
  makeThreadListEntry,
  makeWorkspaceStatus,
};

const noop = () => {};

export const localEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
};

export function PanelStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[480px] min-w-0 rounded-md border border-border bg-background px-4 py-3">
      {children}
    </div>
  );
}

export const parentThreads: ThreadListEntry[] = [
  makeThreadListEntry({
    id: "thr_codex_parent",
    title: "Codex Parent",
    titleFallback: "Codex Parent",
  }),
  makeThreadListEntry({
    id: "thr_frontend_parent",
    title: "Frontend Parent",
    titleFallback: "Frontend Parent",
  }),
];

export const baseProps: ThreadMetadataContentProps = {
  thread: makeThread(),
  projectId: "proj_bb",
  parentThreadDisplayName: null,
  parentThreads,
  canAssignToParent: true,
  canTakeOverThread: false,
  environment: makeEnvironment(),
  environmentDisplayHost: localEnvironmentDisplayHost,
  workspaceStatus: makeWorkspaceStatus(),
  workspaceStatusError: null,
  pullRequest: null,
  selectedMergeBaseBranch: undefined,
  mergeBaseBranchOptions: ["main", "develop", "release/2026-04"],
  isLoadingMergeBaseBranchOptions: false,
  updateThreadPending: false,
  onAssignParent: noop,
  onMergeBaseBranchChange: noop,
  onChangedFileClick: noop,
};
