import { useMemo, type CSSProperties } from "react";
import { FileTree } from "@pierre/trees/react";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { usePreferredTheme } from "@/hooks/useTheme";
import type { WorkspaceFileTreeController } from "./useWorkspaceFileTree";

interface WorkspaceFileTreeProps {
  controller: WorkspaceFileTreeController;
}

interface FileTreeHostStyle extends CSSProperties {
  "--trees-bg-override": string;
  "--trees-fg-override": string;
  "--trees-font-family-override": string;
  "--trees-font-size-override": string;
  "--trees-icon-width-override": string;
  "--trees-padding-inline-override": string;
  "--trees-selected-bg-override": string;
}

const BASE_STYLE: FileTreeHostStyle = {
  "--trees-bg-override": "transparent",
  "--trees-fg-override": "var(--foreground)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "var(--text-xs)",
  "--trees-icon-width-override": "14px",
  "--trees-padding-inline-override": "0",
  "--trees-selected-bg-override":
    "color-mix(in srgb, var(--accent) 65%, transparent)",
  height: "100%",
};

export function WorkspaceFileTree({ controller }: WorkspaceFileTreeProps) {
  const preferredTheme = usePreferredTheme();
  const style = useMemo<FileTreeHostStyle>(
    () => ({ ...BASE_STYLE, colorScheme: preferredTheme }),
    [preferredTheme],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {controller.error ? (
          <EmptyState
            message={controller.error.message}
            messageClassName="text-destructive"
          />
        ) : controller.isLoading && controller.model.getVisibleCount() === 0 ? (
          <EmptyState
            icon="Spinner"
            iconClassName="animate-spin"
            message="Loading files..."
          />
        ) : controller.model.getVisibleCount() === 0 ? (
          <EmptyState message="This directory is empty." />
        ) : (
          <FileTree
            aria-label="All workspace files"
            className="block h-full min-h-0"
            model={controller.model}
            style={style}
          />
        )}
      </div>
    </div>
  );
}
