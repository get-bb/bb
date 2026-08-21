import type { PermissionMode } from "@bb/domain";
import { useMemo } from "react";
import type { PermissionModePickerOption } from "@/data/compose";
import { useSheet, type IconName } from "@/ui";
import { OptionSheet, type PickerOption } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";

const PERMISSION_MODE_ICON: Record<PermissionMode, IconName> = {
  "accept-edits": "EditFile",
  auto: "CircleCheck",
  full: "Zap",
};

export interface PermissionModePickerProps {
  /** From `buildPermissionModeOptions` (modes above the machine ceiling disabled). */
  options: readonly PermissionModePickerOption[];
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
  testID?: string;
}

/** Permission mode picker; labels/descriptions come from client-core. */
export function PermissionModePicker({
  options,
  value,
  onChange,
  disabled,
  testID = "permission-mode-picker",
}: PermissionModePickerProps) {
  const sheet = useSheet();
  const rows = useMemo(
    (): PickerOption<PermissionMode>[] =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
        icon: PERMISSION_MODE_ICON[option.value],
        disabled: option.disabled,
        disabledReason: option.disabledReason ?? undefined,
        tone: option.tone,
      })),
    [options],
  );
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <PickerTrigger
        icon={PERMISSION_MODE_ICON[value]}
        label={selected?.label ?? "Permissions"}
        onPress={sheet.present}
        disabled={disabled || options.length <= 1}
        testID={testID}
        accessibilityLabel="Permission mode"
      />
      <OptionSheet
        controller={sheet}
        title="Permissions"
        options={rows}
        value={value}
        onChange={onChange}
        testIDPrefix={`${testID}-option`}
      />
    </>
  );
}
