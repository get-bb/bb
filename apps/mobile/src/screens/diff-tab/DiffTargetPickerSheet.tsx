import { View } from "react-native";
import type { DiffSelectionOption } from "@/data/diff";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Text,
  type SheetController,
} from "@/ui";
import { usePickerSheetMaxHeight } from "../pickers/OptionSheet";

interface DiffTargetPickerSheetProps {
  controller: SheetController;
  options: readonly DiffSelectionOption[];
  /** The picker value for the active target. */
  value: string;
  onChange: (value: string) => void;
  /** The merge base behind the branch targets; null hides the row. */
  mergeBase: { branch: string; onPress: () => void } | null;
  /**
   * `push` when the picker opens over another sheet (the Diff tab inside the
   * workspace sheet): the default `replace` would dismiss the host sheet.
   */
  stackBehavior?: "push" | "replace" | "switch";
}

/**
 * The diff target picker (web `GitDiffToolbar` select): all / committed /
 * uncommitted changes, then one row per commit above the merge base, with the
 * merge-base row at the bottom opening the branch picker.
 */
export function DiffTargetPickerSheet({
  controller,
  options,
  value,
  onChange,
  mergeBase,
  stackBehavior,
}: DiffTargetPickerSheetProps) {
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  return (
    <Sheet
      controller={controller}
      title="Diff"
      layout="scroll"
      maxDynamicContentSize={maxHeight}
      stackBehavior={stackBehavior}
    >
      <View testID="diff-target-sheet">
        {options.map((option) => (
          <ListRow
            key={option.value}
            title={option.label}
            leading={
              option.monoPrefix ? (
                <Text variant="mono" tone="muted" className="text-xs">
                  {option.monoPrefix}
                </Text>
              ) : undefined
            }
            trailing={
              option.value === value ? (
                <Icon name="Check" size={18} color={tokens.foreground} />
              ) : null
            }
            selected={option.value === value}
            onPress={() => {
              controller.dismiss();
              onChange(option.value);
            }}
            testID={`diff-target-${option.value}`}
          />
        ))}
        {mergeBase ? (
          <>
            <Separator />
            <ListRow
              title={`Merge base: ${mergeBase.branch}`}
              leading="GitMerge"
              trailing="chevron"
              onPress={mergeBase.onPress}
              testID="diff-target-merge-base"
            />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
