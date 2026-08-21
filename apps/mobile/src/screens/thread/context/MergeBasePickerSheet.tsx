import { useState } from "react";
import { View } from "react-native";
import {
  getMergeBaseBranchCandidateGroups,
  useEnvironmentMergeBaseBranches,
} from "@/data/environments";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Sheet,
  Spinner,
  Text,
  type SheetController,
} from "@/ui";
import { SheetInput } from "../../pickers/SheetInput";
import { usePickerSheetMaxHeight } from "../../pickers/OptionSheet";

export interface MergeBasePickerSheetProps {
  controller: SheetController;
  environmentId: string | null;
  /** The branch compared against right now. */
  mergeBaseBranch: string | undefined;
  onSelect: (branch: string) => void;
  /** `push` when presented over another sheet (the Diff tab's target picker). */
  stackBehavior?: "push" | "replace" | "switch";
}

/**
 * Merge-base picker (web BranchPicker in its "minimal" merge-base role):
 * searchable local branches, then remote-tracking branches, the current
 * pick pinned in whichever group it belongs to.
 */
export function MergeBasePickerSheet({
  controller,
  environmentId,
  mergeBaseBranch,
  onSelect,
  stackBehavior,
}: MergeBasePickerSheetProps) {
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  const [query, setQuery] = useState("");
  const branches = useEnvironmentMergeBaseBranches(environmentId, {
    query,
    selectedBranch: mergeBaseBranch,
  });
  const candidates = getMergeBaseBranchCandidateGroups({
    mergeBaseBranch,
    mergeBaseBranchRef: branches.data?.selectedBranch,
    mergeBaseBranchOptions: branches.data?.branches ?? [],
    remoteMergeBaseBranchOptions: branches.data?.remoteBranches ?? [],
  });
  const pick = (branch: string) => {
    controller.dismiss();
    onSelect(branch);
  };
  const renderRow = (branch: string, remote: boolean) => (
    <ListRow
      key={`${remote ? "remote" : "local"}:${branch}`}
      title={branch}
      leading="GitBranch"
      selected={branch === mergeBaseBranch}
      trailing={
        branch === mergeBaseBranch ? (
          <Icon name="Check" size={18} color={tokens.foreground} />
        ) : null
      }
      onPress={() => pick(branch)}
      testID={`merge-base-option-${branch}`}
    />
  );
  const isEmpty =
    !branches.isLoading &&
    candidates.options.length === 0 &&
    candidates.remoteOptions.length === 0;

  return (
    <Sheet
      controller={controller}
      title="Merge base"
      layout="scroll"
      snapPoints={[maxHeight]}
      stackBehavior={stackBehavior}
    >
      <View className="px-4 pb-2 pt-3">
        <SheetInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search branches"
          autoCapitalize="none"
          mono
          testID="merge-base-search"
        />
      </View>
      {branches.isLoading ? (
        <View className="flex-row items-center gap-2 px-4 py-3">
          <Spinner size="small" />
          <Text variant="caption">Loading branches…</Text>
        </View>
      ) : null}
      {candidates.options.map((branch) => renderRow(branch, false))}
      {candidates.remoteOptions.length > 0 ? (
        <Text variant="sectionLabel" className="px-4 pb-1 pt-3">
          Remote
        </Text>
      ) : null}
      {candidates.remoteOptions.map((branch) => renderRow(branch, true))}
      {isEmpty ? (
        <Text variant="caption" className="px-4 py-3">
          No branches match.
        </Text>
      ) : null}
    </Sheet>
  );
}
