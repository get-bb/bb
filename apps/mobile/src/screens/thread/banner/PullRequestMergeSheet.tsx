import type { PullRequestMergeMethod } from "@bb/server-contract";
import { useMemo } from "react";
import { PULL_REQUEST_MERGE_ACTIONS } from "@/data/environments";
import {
  ActionSheet,
  type ActionSheetAction,
  type SheetController,
} from "@/ui";

interface PullRequestMergeSheetProps {
  controller: SheetController;
  pullRequestNumber: number;
  onMerge: (method: PullRequestMergeMethod) => void;
  onConvertToDraft: () => void;
  disabled: boolean;
}

/** The web merge split-button menu: merge / squash / rebase, convert to draft. */
export function PullRequestMergeSheet({
  controller,
  pullRequestNumber,
  onMerge,
  onConvertToDraft,
  disabled,
}: PullRequestMergeSheetProps) {
  const actions = useMemo<ActionSheetAction[]>(
    () => [
      ...PULL_REQUEST_MERGE_ACTIONS.map<ActionSheetAction>((action) => ({
        key: `merge-${action.method}`,
        label: action.label,
        icon: "GitMerge",
        disabled,
        onPress: () => onMerge(action.method),
      })),
      {
        key: "convert-to-draft",
        label: "Convert to draft",
        icon: "GitPullRequestDraft",
        disabled,
        onPress: onConvertToDraft,
      },
    ],
    [disabled, onConvertToDraft, onMerge],
  );
  return (
    <ActionSheet
      controller={controller}
      title={`Merge pull request #${pullRequestNumber}`}
      actions={actions}
    />
  );
}
