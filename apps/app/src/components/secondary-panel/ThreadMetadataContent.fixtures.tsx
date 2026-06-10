import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import {
  makeEnvironment,
  makeThread,
  makeThreadListEntry,
  makeThreadSchedule,
  makeWorkspaceStatus,
} from "../../../.ladle/story-fixtures";
import type { ThreadMetadataContentProps } from "./ThreadMetadataContent";

// Re-export the shared builders so per-row stories in this folder can import
// from one place.
export {
  makeEnvironment,
  makeThread,
  makeThreadListEntry,
  makeThreadSchedule,
  makeWorkspaceStatus,
};

const noop = () => {};

export function PanelStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[480px] min-w-0 rounded-md border border-border bg-background px-4 py-3">
      {children}
    </div>
  );
}

export const managerThreads: ThreadListEntry[] = [
  makeThreadListEntry({
    id: "thr_codex_manager",
    type: "manager",
    title: "Codex Manager",
    titleFallback: "Codex Manager",
  }),
  makeThreadListEntry({
    id: "thr_frontend_manager",
    type: "manager",
    title: "Frontend Manager",
    titleFallback: "Frontend Manager",
  }),
];

export const baseProps: ThreadMetadataContentProps = {
  thread: makeThread(),
  projectId: "proj_bb",
  parentThreadDisplayName: null,
  managerThreads,
  canAssignToManager: true,
  canTakeOverThread: false,
  environment: makeEnvironment(),
  workspaceStatus: makeWorkspaceStatus(),
  workspaceStatusError: null,
  pullRequest: null,
  selectedMergeBaseBranch: undefined,
  mergeBaseBranchOptions: ["main", "develop", "release/2026-04"],
  isLoadingMergeBaseBranchOptions: false,
  threadSchedules: [],
  updateThreadPending: false,
  onAssignManager: noop,
  onMergeBaseBranchChange: noop,
  onChangedFileClick: noop,
};
