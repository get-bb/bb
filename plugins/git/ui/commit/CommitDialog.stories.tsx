import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";
import type { WorkspaceChangedFilesSection } from "@bb/shared-ui/workspace-change-summary";
import type { WorkspaceFileStatus } from "../../contract.js";
import { CommitDialogContent } from "./CommitDialog.js";

export default {
  title: "plugins/Git/Commit dialog",
};

const noop = () => {};

const changedFiles: WorkspaceFileStatus[] = [
  {
    path: "apps/app/src/components/thread/dialogs/ThreadRenameDialog.tsx",
    status: "M",
    insertions: 28,
    deletions: 11,
  },
  {
    path: "apps/app/src/components/thread/dialogs/ThreadRenameDialog.stories.tsx",
    status: "A",
    insertions: 64,
    deletions: 0,
  },
  {
    path: "plugins/git/ui/commit/CommitDialog.tsx",
    status: "M",
    insertions: 14,
    deletions: 6,
  },
];

const changedFilesSection: WorkspaceChangedFilesSection = {
  kind: "uncommitted",
  label: "Uncommitted",
  files: changedFiles,
  mergeBaseRef: null,
  stats: {
    files: changedFiles,
    insertions: 106,
    deletions: 17,
    lineStatsComplete: true,
    fileCount: changedFiles.length,
  },
};

function OpenDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-sm">
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Commit() {
  return (
    <OpenDialog>
      <CommitDialogContent
        branchName="feat/sidebar-rail"
        gitStatusDisplay={{ label: "Dirty", summary: "" }}
        changedFilesSection={changedFilesSection}
        onCommit={noop}
      />
    </OpenDialog>
  );
}

export function Minimal() {
  return (
    <OpenDialog>
      <CommitDialogContent onCommit={noop} />
    </OpenDialog>
  );
}
