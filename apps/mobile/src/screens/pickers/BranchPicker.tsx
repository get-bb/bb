import { View } from "react-native";
import type { BranchSelection } from "@/data/compose";
import { useTheme } from "@/theme";
import { Icon, ListRow, Separator, Sheet, Spinner, Text, useSheet } from "@/ui";
import { usePickerSheetMaxHeight } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";
import { SheetInput } from "./SheetInput";

type BranchPickerMode = "local" | "worktree";

export interface BranchPickerProps {
  /** `local`: branch to check out in the project folder; `worktree`: base branch. */
  mode: BranchPickerMode;
  /** Local branches (server-filtered by `searchQuery`, selected branch first). */
  branches: readonly string[];
  remoteBranches: readonly string[];
  /** Null = the default (current checkout branch / default worktree base). */
  selected: BranchSelection | null;
  /** The branch used when nothing is picked (checkout branch or default base). */
  defaultBranch: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  isLoading?: boolean;
  onSelect: (name: string) => void;
  onClear: () => void;
  /** Local mode: create a new thread-named branch from `baseName` first. */
  onCreateFrom?: (baseName: string) => void;
  disabled?: boolean;
}

function describeBranchSelection(
  mode: BranchPickerMode,
  selected: BranchSelection | null,
  defaultBranch: string | null,
): string {
  if (mode === "worktree") {
    return `from ${selected?.name ?? defaultBranch ?? "default branch"}`;
  }
  if (selected === null) return defaultBranch ?? "Branch";
  return selected.isNew ? `New branch from ${selected.name}` : selected.name;
}

/**
 * Branch picker for host-mode environments: searchable local + remote
 * branches, a "use the default" row, and (local mode) a "create a new branch
 * from …" row that mirrors the web BranchPicker's create affordance.
 */
export function BranchPicker({
  mode,
  branches,
  remoteBranches,
  selected,
  defaultBranch,
  searchQuery,
  onSearchQueryChange,
  isLoading = false,
  onSelect,
  onClear,
  onCreateFrom,
  disabled,
}: BranchPickerProps) {
  const sheet = useSheet();
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  const label = describeBranchSelection(mode, selected, defaultBranch);
  const baseForNew = selected?.name ?? defaultBranch;
  const pick = (name: string) => {
    sheet.dismiss();
    onSelect(name);
  };
  const trimmedQuery = searchQuery.trim();
  const showRemote = remoteBranches.length > 0;

  return (
    <>
      <PickerTrigger
        icon="GitBranch"
        label={label}
        onPress={sheet.present}
        disabled={disabled}
        loading={isLoading && branches.length === 0 && selected === null}
        testID="branch-picker"
        accessibilityLabel={mode === "worktree" ? "Base branch" : "Branch"}
      />
      <Sheet
        controller={sheet}
        title={mode === "worktree" ? "Base branch" : "Branch"}
        layout="scroll"
        snapPoints={[maxHeight]}
      >
        <View className="px-4 pb-2 pt-3">
          <SheetInput
            value={searchQuery}
            onChangeText={onSearchQueryChange}
            placeholder="Search branches"
            autoCapitalize="none"
            mono
            testID="branch-picker-search"
          />
        </View>
        <ListRow
          title={
            mode === "worktree"
              ? `Default base${defaultBranch ? ` (${defaultBranch})` : ""}`
              : `Current branch${defaultBranch ? ` (${defaultBranch})` : ""}`
          }
          leading="GitBranch"
          selected={selected === null}
          trailing={
            selected === null ? (
              <Icon name="Check" size={18} color={tokens.foreground} />
            ) : null
          }
          onPress={() => {
            sheet.dismiss();
            onClear();
          }}
          testID="branch-picker-default"
        />
        {mode === "local" && onCreateFrom && baseForNew ? (
          <ListRow
            title={`Create a new branch from ${baseForNew}`}
            subtitle="bb names the branch after the thread."
            leading="Plus"
            selected={selected?.isNew === true}
            trailing={
              selected?.isNew ? (
                <Icon name="Check" size={18} color={tokens.foreground} />
              ) : null
            }
            onPress={() => {
              sheet.dismiss();
              onCreateFrom(baseForNew);
            }}
            testID="branch-picker-create"
          />
        ) : null}
        <Separator />
        {isLoading && branches.length === 0 ? (
          <View className="flex-row items-center gap-2 px-4 py-3">
            <Spinner />
            <Text variant="caption">Loading branches…</Text>
          </View>
        ) : null}
        {!isLoading && branches.length === 0 && !showRemote ? (
          <View className="px-4 py-4">
            <Text variant="caption">
              {trimmedQuery
                ? `No branches match “${trimmedQuery}”.`
                : "No branches."}
            </Text>
          </View>
        ) : null}
        {branches.map((name) => {
          const isSelected = selected?.name === name && !selected.isNew;
          return (
            <ListRow
              key={`local:${name}`}
              title={name}
              selected={isSelected}
              trailing={
                isSelected ? (
                  <Icon name="Check" size={18} color={tokens.foreground} />
                ) : null
              }
              onPress={() => pick(name)}
              testID={`branch-picker-option-${name}`}
            />
          );
        })}
        {showRemote ? (
          <>
            <View className="px-4 pb-1 pt-3">
              <Text variant="sectionLabel">Remote branches</Text>
            </View>
            {remoteBranches.map((name) => {
              const isSelected = selected?.name === name && !selected.isNew;
              return (
                <ListRow
                  key={`remote:${name}`}
                  title={name}
                  leading="Globe"
                  selected={isSelected}
                  trailing={
                    isSelected ? (
                      <Icon name="Check" size={18} color={tokens.foreground} />
                    ) : null
                  }
                  onPress={() => pick(name)}
                  testID={`branch-picker-remote-${name}`}
                />
              );
            })}
          </>
        ) : null}
      </Sheet>
    </>
  );
}
