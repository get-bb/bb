import type { ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { haptic } from "@/lib/haptics";
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

export interface PickerOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  /** Custom leading node (a provider logo); wins over `icon`. */
  leading?: ReactNode;
  disabled?: boolean;
  /** Shown as the subtitle when disabled (why it cannot be picked). */
  disabledReason?: string;
  tone?: "default" | "warning";
}

/** Fraction of the window a dynamic-height picker sheet may grow to. */
const PICKER_SHEET_MAX_HEIGHT_RATIO = 0.75;

export function usePickerSheetMaxHeight(): number {
  const { height } = useWindowDimensions();
  return Math.round(height * PICKER_SHEET_MAX_HEIGHT_RATIO);
}

interface OptionRowProps<T extends string> {
  option: PickerOption<T>;
  selected: boolean;
  onSelect: (value: T) => void;
  testID?: string;
}

/** One selectable row: glyph, label/description, check mark when selected. */
function OptionRow<T extends string>({
  option,
  selected,
  onSelect,
  testID,
}: OptionRowProps<T>) {
  const { tokens } = useTheme();
  const disabled = option.disabled === true;
  return (
    <ListRow
      title={option.label}
      subtitle={
        disabled && option.disabledReason
          ? option.disabledReason
          : option.description
      }
      leading={
        option.leading ??
        (option.icon ? (
          <Icon
            name={option.icon}
            size={20}
            color={
              option.tone === "warning" ? tokens.warningText : tokens.foreground
            }
          />
        ) : undefined)
      }
      trailing={
        selected ? (
          <Icon name="Check" size={18} color={tokens.foreground} />
        ) : null
      }
      selected={selected}
      disabled={disabled}
      onPress={() => onSelect(option.value)}
      testID={testID}
      accessibilityLabel={option.label}
    />
  );
}

interface OptionSheetProps<T extends string> {
  controller: SheetController;
  title: string;
  options: readonly PickerOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Rendered above the options (search field, description). */
  header?: ReactNode;
  /** Rendered below the options (toggles, secondary actions). */
  footer?: ReactNode;
  /** Shown instead of the list when there are no options. */
  emptyMessage?: string;
  /** Prefix for per-row testIDs (`<prefix>-<value>`). */
  testIDPrefix?: string;
  onDismiss?: () => void;
}

/**
 * A single-choice list in a bottom sheet with a check mark on the current
 * value. The sheet closes on selection.
 */
export function OptionSheet<T extends string>({
  controller,
  title,
  options,
  value,
  onChange,
  header,
  footer,
  emptyMessage = "Nothing to pick yet.",
  testIDPrefix,
  onDismiss,
}: OptionSheetProps<T>) {
  const maxHeight = usePickerSheetMaxHeight();
  return (
    <Sheet
      controller={controller}
      title={title}
      layout="scroll"
      maxDynamicContentSize={maxHeight}
      onDismiss={onDismiss}
    >
      {header}
      {options.length === 0 ? (
        <View className="px-4 py-6">
          <Text variant="caption" className="text-center">
            {emptyMessage}
          </Text>
        </View>
      ) : (
        options.map((option) => (
          <OptionRow
            key={option.value}
            option={option}
            selected={option.value === value}
            onSelect={(next) => {
              haptic("selection");
              controller.dismiss();
              onChange(next);
            }}
            testID={
              testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined
            }
          />
        ))
      )}
      {footer ? (
        <>
          <Separator />
          {footer}
        </>
      ) : null}
    </Sheet>
  );
}
