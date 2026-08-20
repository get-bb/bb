import type { WorkspaceFileStatus } from "@bb/domain";
import { Pressable, View } from "react-native";
import { formatWorkspaceFileStatus } from "@/data/environments";
import { Text } from "@/ui";

export interface WorkspaceChangesListProps {
  files: readonly WorkspaceFileStatus[];
  /** Tap a file (diff preview arrives with the Phase 6 workspace surfaces). */
  onPressFile: (file: WorkspaceFileStatus) => void;
  /** Rows beyond this many collapse into a "+N more" line. */
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 8;

function statusTone(status: string): string {
  switch (status) {
    case "A":
    case "??":
      return "text-success";
    case "D":
      return "text-destructive-text";
    default:
      return "text-muted-foreground";
  }
}

/** Web WorkspaceChangesList: status letter, path, per-file +/- counts. */
export function WorkspaceChangesList({
  files,
  onPressFile,
  maxRows = DEFAULT_MAX_ROWS,
}: WorkspaceChangesListProps) {
  const visible = files.slice(0, maxRows);
  const hidden = files.length - visible.length;
  return (
    <View className="gap-0.5" testID="workspace-changes-list">
      {visible.map((file) => (
        <Pressable
          key={`${file.status}:${file.path}`}
          accessibilityRole="button"
          onPress={() => onPressFile(file)}
          className="min-h-7 flex-row items-center gap-2 rounded-sm px-1 active:bg-state-hover"
          testID="workspace-changes-file"
        >
          <Text
            variant="mono"
            className={`w-6 text-xs ${statusTone(file.status)}`}
            numberOfLines={1}
          >
            {formatWorkspaceFileStatus(file.status)}
          </Text>
          <Text
            variant="mono"
            className="min-w-0 flex-1 text-xs"
            numberOfLines={1}
          >
            {file.path}
          </Text>
          {file.insertions !== null || file.deletions !== null ? (
            <Text variant="mono" className="text-xs" numberOfLines={1}>
              {file.insertions ? (
                <Text className="text-xs text-success">{`+${file.insertions}`}</Text>
              ) : null}
              {file.insertions && file.deletions ? " " : null}
              {file.deletions ? (
                <Text className="text-xs text-destructive-text">{`-${file.deletions}`}</Text>
              ) : null}
            </Text>
          ) : null}
        </Pressable>
      ))}
      {hidden > 0 ? (
        <Text variant="caption" className="px-1 pt-1">
          {`+${hidden} more`}
        </Text>
      ) : null}
    </View>
  );
}
