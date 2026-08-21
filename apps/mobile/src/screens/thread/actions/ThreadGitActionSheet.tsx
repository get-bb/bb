import { View } from "react-native";
import {
  formatChangedFilesSectionLabel,
  getThreadGitActionSheetCopy,
  type GitStatusDisplay,
  type ThreadGitActionTarget,
  type ThreadHeaderGitAction,
  type WorkspaceChangedFilesSection,
} from "@/data/environments";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Text,
  type IconName,
  type SheetController,
} from "@/ui";

interface ThreadGitActionSheetProps {
  controller: SheetController;
  /** The actions the header offers (web `threadHeaderGitActions`). */
  actions: readonly ThreadHeaderGitAction[];
  branchName: string | null;
  gitStatus: GitStatusDisplay;
  changedFiles: WorkspaceChangedFilesSection | null;
  /** The merge base squash merges target; null hides the row. */
  mergeBaseBranch: string | null;
  /** Opens the merge-base picker (null when the picker does not apply). */
  onPickMergeBase: (() => void) | null;
  /** One action is running; rows disable. */
  pending: boolean;
  onRun: (target: ThreadGitActionTarget) => void;
}

function actionIcon(target: ThreadGitActionTarget): IconName {
  return target.kind === "commit" ? "Check" : "GitMerge";
}

/**
 * The header's git sheet (stand-in for the web ThreadGitActionDialog until
 * the Phase 6 workspace surfaces): branch + status, the changed-files
 * summary, the merge base, and one row per available action. The server
 * writes the commit message itself (AI-generated from the diff), so the
 * sheet takes no message input.
 */
export function ThreadGitActionSheet({
  controller,
  actions,
  branchName,
  gitStatus,
  changedFiles,
  mergeBaseBranch,
  onPickMergeBase,
  pending,
  onRun,
}: ThreadGitActionSheetProps) {
  const { tokens } = useTheme();
  const summary = [gitStatus.label, gitStatus.summary]
    .filter((part) => part.trim().length > 0)
    .join(" · ");
  return (
    <Sheet controller={controller} title="Git" layout="scroll">
      <View className="gap-1 px-4 pb-3 pt-1" testID="thread-git-sheet">
        {branchName ? (
          <View className="flex-row items-center gap-1.5">
            <Icon name="GitBranch" size={14} color={tokens.mutedForeground} />
            <Text variant="mono" numberOfLines={1} className="flex-1">
              {branchName}
            </Text>
          </View>
        ) : null}
        <Text variant="caption">{summary}</Text>
        {changedFiles ? (
          <Text variant="caption" testID="thread-git-changed-files">
            {formatChangedFilesSectionLabel(changedFiles)}
          </Text>
        ) : null}
      </View>
      {mergeBaseBranch ? (
        <ListRow
          title={`Merge base: ${mergeBaseBranch}`}
          leading="GitMerge"
          trailing={onPickMergeBase ? "chevron" : undefined}
          onPress={onPickMergeBase ?? undefined}
          disabled={pending}
          testID="thread-git-merge-base"
        />
      ) : null}
      <Separator />
      {actions.length === 0 ? (
        <Text variant="caption" className="px-4 py-3">
          Nothing to commit or merge.
        </Text>
      ) : (
        actions.map((action) => {
          const copy = getThreadGitActionSheetCopy(action.target);
          return (
            <ListRow
              key={action.target.kind}
              title={copy.submitLabel}
              subtitle={
                copy.showMergeBase && mergeBaseBranch
                  ? `${copy.description} (${mergeBaseBranch})`
                  : copy.description
              }
              leading={actionIcon(action.target)}
              disabled={pending || (copy.showMergeBase && !mergeBaseBranch)}
              onPress={() => {
                controller.dismiss();
                onRun(action.target);
              }}
              testID={`thread-git-action-${action.target.kind}`}
            />
          );
        })
      )}
    </Sheet>
  );
}
