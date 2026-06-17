import { useMemo } from "react";
import type { PermissionMode } from "@bb/domain";
import { OptionPicker, type PickerOption } from "./OptionPicker";

type PermissionModeOption = PickerOption<PermissionMode>;

function getPermissionModeCompactLabel(value: PermissionMode): string {
  switch (value) {
    case "full":
      return "Full";
    case "workspace-write":
      return "Write";
    case "readonly":
      return "Read";
  }
}

function addPermissionModeCompactLabels(
  options: readonly PermissionModeOption[],
): PermissionModeOption[] {
  return options.map((option) => ({
    ...option,
    compactLabel:
      option.compactLabel ?? getPermissionModeCompactLabel(option.value),
  }));
}

export interface PermissionModePickerProps {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
  className?: string;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. Defaults to true. */
  muted?: boolean;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories. */
  modal?: boolean;
  /**
   * Render the picker as a non-interactive, dimmed label (read-only surfaces,
   * e.g. the side chat). The selected mode still shows; the menu never opens.
   */
  disabled?: boolean;
}

/**
 * Permission mode picker. Returns null when the provider doesn't support
 * picking (`supported=false`), the current value has not loaded yet, or
 * there's nothing to choose between. A `disabled` picker renders the same
 * selected-mode label as its interactive counterpart, just non-interactive
 * (read-only surfaces, e.g. the side chat).
 */
export function PermissionModePicker({
  value,
  options,
  onChange,
  supported,
  className,
  muted = true,
  defaultOpen,
  modal,
  disabled,
}: PermissionModePickerProps) {
  const compactOptions = useMemo(
    () => addPermissionModeCompactLabels(options),
    [options],
  );
  if (!supported || value === undefined || options.length <= 1) {
    return null;
  }
  return (
    <OptionPicker
      label="Permission mode"
      value={value}
      options={compactOptions}
      onChange={onChange}
      className={className}
      contentClassName="max-w-72"
      muted={muted}
      defaultOpen={defaultOpen}
      modal={modal}
      align="end"
      disabled={disabled}
    />
  );
}
