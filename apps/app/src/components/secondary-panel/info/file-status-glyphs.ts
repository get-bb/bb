import type { WorkspaceFileStatusKind } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

export interface FileStatusGlyph {
  icon: IconName;
  label: string;
  description: string;
  className: string;
}

export const FILE_STATUS_GLYPHS: Record<
  WorkspaceFileStatusKind,
  FileStatusGlyph
> = {
  M: {
    icon: "DiffModified",
    label: "Modified",
    description: "Modified: existing file with edits",
    className: "text-subtle-foreground",
  },
  A: {
    icon: "DiffAdded",
    label: "Added",
    description: "Added: new file staged in git",
    className: "text-diff-added",
  },
  "??": {
    icon: "DiffAdded",
    label: "Untracked",
    description: "Untracked: new file git isn't tracking yet",
    className: "text-diff-added",
  },
  D: {
    icon: "DiffRemoved",
    label: "Deleted",
    description: "Deleted: file was removed",
    className: "text-diff-removed",
  },
  R: {
    icon: "DiffRenamed",
    label: "Renamed",
    description: "Renamed: file was moved or renamed",
    className: "text-subtle-foreground",
  },
  C: {
    icon: "Copy",
    label: "Copied",
    description: "Copied: new file copied from another",
    className: "text-subtle-foreground",
  },
  U: {
    icon: "DiffConflict",
    label: "Conflict",
    description: "Conflict: unresolved merge conflict",
    className: "text-destructive",
  },
  "?": {
    icon: "CircleQuestion",
    label: "Unknown",
    description: "Unknown git status",
    className: "text-subtle-foreground",
  },
};
