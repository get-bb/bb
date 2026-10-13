import type { WorkspaceFileStatusKind } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

export interface FileStatusGlyph {
  icon: IconName;
  label: string;
  className: string;
}

export const FILE_STATUS_GLYPHS: Record<
  WorkspaceFileStatusKind,
  FileStatusGlyph
> = {
  M: {
    icon: "DiffModified",
    label: "Modified",
    className: "text-subtle-foreground",
  },
  A: {
    icon: "DiffAdded",
    label: "Added",
    className: "text-diff-added",
  },
  "??": {
    icon: "DiffAdded",
    label: "Added",
    className: "text-diff-added",
  },
  D: {
    icon: "DiffRemoved",
    label: "Deleted",
    className: "text-diff-removed",
  },
  R: {
    icon: "DiffRenamed",
    label: "Renamed",
    className: "text-subtle-foreground",
  },
  C: {
    icon: "Copy",
    label: "Copied",
    className: "text-subtle-foreground",
  },
  U: {
    icon: "DiffConflict",
    label: "Conflict",
    className: "text-destructive",
  },
  "?": {
    icon: "CircleQuestion",
    label: "Unknown",
    className: "text-subtle-foreground",
  },
};
