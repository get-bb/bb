import type { Host } from "@bb/domain";
import type {
  ReuseEnvironmentOption,
  ThreadEnvironmentSelection,
} from "@/data/compose";

interface EnvironmentSelectionSummary {
  label: string;
  icon: "Laptop" | "FolderGit" | "Folder";
  tone: "default" | "warning";
}

export function describeEnvironmentSelection(
  value: ThreadEnvironmentSelection,
  host: Host | null,
  reuseOptions: readonly ReuseEnvironmentOption[],
): EnvironmentSelectionSummary {
  switch (value.type) {
    case "project-default":
      return { label: "Project default", icon: "Laptop", tone: "default" };
    case "reuse": {
      const option = reuseOptions.find(
        (candidate) => candidate.environmentId === value.environmentId,
      );
      const name = option?.name ?? option?.branchName;
      return {
        label: name ? `Reuse ${name}` : "Reuse worktree",
        icon: "FolderGit",
        tone: "default",
      };
    }
    case "host": {
      const offline = host !== null && host.status !== "connected";
      if (value.workspace.type === "managed-worktree") {
        return {
          label: "New worktree",
          icon: "FolderGit",
          tone: offline ? "warning" : "default",
        };
      }
      if (value.workspace.type === "personal") {
        return {
          label: "Personal workspace",
          icon: "Laptop",
          tone: offline ? "warning" : "default",
        };
      }
      const custom = value.workspace.path;
      return {
        label: custom ?? "Work in checkout",
        icon: "Folder",
        tone: offline ? "warning" : "default",
      };
    }
  }
}
