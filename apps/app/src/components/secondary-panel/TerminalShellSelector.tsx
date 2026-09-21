// bb-fork(windows): shell picker beside the Start terminal action.
import { useMemo } from "react";
import type { TerminalShellOption } from "@bb/domain";
import {
  OptionPicker,
  type PickerOption,
} from "@/components/pickers/OptionPicker";

const CONTROL_CLASS_NAME = "h-6 max-w-40 px-1.5 text-xs";

interface TerminalShellSelectorProps {
  defaultShell: TerminalShellOption | null;
  disabled?: boolean;
  isLoading: boolean;
  onChange: (shellId: string) => void;
  selectedShellId: string;
  shells: readonly TerminalShellOption[];
}

export function TerminalShellSelector({
  defaultShell,
  disabled = false,
  isLoading,
  onChange,
  selectedShellId,
  shells,
}: TerminalShellSelectorProps) {
  const options = useMemo<readonly PickerOption<string>[]>(
    () =>
      shells.map((shell) => ({
        value: shell.id,
        label: shell.label,
        description: shell.path,
      })),
    [shells],
  );

  if (isLoading || shells.length < 2) {
    return null;
  }

  const selected =
    options.find((option) => option.value === selectedShellId) ??
    options.find((option) => option.value === defaultShell?.id) ??
    options[0];
  if (selected === undefined) {
    return null;
  }

  return (
    <OptionPicker
      align="end"
      label="Shell"
      value={selected.value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      muted
      className={CONTROL_CLASS_NAME}
      contentClassName="max-w-72"
    />
  );
}
