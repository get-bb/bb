import { useTheme } from "@/theme";
import {
  GroupedRow,
  Icon,
  useSheet,
  type GroupedRowProps,
  type IconName,
} from "@/ui";
import { OptionSheet, type PickerOption } from "../pickers/OptionSheet";

export interface MenuValueOption<T extends string = string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface MenuValueRowProps<T extends string = string> {
  title: string;
  subtitle?: string;
  /** The current choice's label (the row value). */
  value: string;
  valueTone?: GroupedRowProps["valueTone"];
  leading?: GroupedRowProps["leading"];
  options: readonly MenuValueOption<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

/** The pop-up glyph of a choice-backed value row (`chevron.up.chevron.down`). */
function MenuChevron() {
  const { tokens } = useTheme();
  return (
    <Icon
      name="ChevronDown"
      symbol="chevron.up.chevron.down"
      size={14}
      weight="semibold"
      color={tokens.subtleForeground}
    />
  );
}

/**
 * A value row in the iOS pop-up button cell look (value + pop-up glyph)
 * that opens a single-choice `OptionSheet` on both platforms. Not a native
 * `MenuView`: that removes the row from the iOS accessibility tree, so
 * VoiceOver and Maestro could not reach it. The option rows carry
 * `<testID>-option-<value>` ids.
 */
export function MenuValueRow<T extends string = string>({
  title,
  subtitle,
  value,
  valueTone,
  leading,
  options,
  selected,
  onSelect,
  disabled = false,
  testID,
  accessibilityLabel,
}: MenuValueRowProps<T>) {
  const sheet = useSheet();
  const pickerOptions: PickerOption<T>[] = options.map((option) => ({
    value: option.value,
    label: option.label,
    icon: option.icon,
    disabled: option.disabled,
  }));
  return (
    <>
      <GroupedRow
        title={title}
        subtitle={subtitle}
        value={value}
        valueTone={valueTone}
        leading={leading}
        trailing={<MenuChevron />}
        disabled={disabled}
        onPress={sheet.present}
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? `${title}: ${value}`}
      />
      <OptionSheet
        controller={sheet}
        title={title}
        options={pickerOptions}
        value={selected}
        onChange={(next) => {
          if (next === selected) return;
          onSelect(next);
        }}
        testIDPrefix={testID ? `${testID}-option` : undefined}
      />
    </>
  );
}
