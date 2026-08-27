import { useMemo } from "react";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { cn } from "@bb/shared-ui/lib/utils";
import { OptionPicker, type PickerOption } from "./OptionPicker";

const DEFAULT_PROFILE_VALUE = "";

export interface PermissionProfilePickerProps {
  value: string | null;
  options: readonly PickerOption<string>[];
  onChange: (value: string | null) => void;
  supported: boolean;
  className?: string;
  disabled?: boolean;
}

export function PermissionProfilePicker({
  value,
  options,
  onChange,
  supported,
  className,
  disabled,
}: PermissionProfilePickerProps) {
  const pickerOptions = useMemo(
    () => [
      {
        value: DEFAULT_PROFILE_VALUE,
        label: "BB default",
        compactLabel: "Default",
        description: "Use BB's permission mode and workspace sandbox.",
      },
      ...options,
    ],
    [options],
  );
  if (!supported || options.length === 0) return null;
  return (
    <OptionPicker
      label="Permission profile"
      value={value ?? DEFAULT_PROFILE_VALUE}
      options={pickerOptions}
      onChange={(nextValue) =>
        onChange(nextValue === DEFAULT_PROFILE_VALUE ? null : nextValue)
      }
      className={cn(LIST_HOVER_TRANSITION, className)}
      contentClassName="max-w-80"
      muted
      align="end"
      disabled={disabled}
    />
  );
}
