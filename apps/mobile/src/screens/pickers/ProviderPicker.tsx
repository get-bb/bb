import { useMemo } from "react";
import type { ProviderPickerOption } from "@/data/compose";
import { useTheme } from "@/theme";
import { useSheet } from "@/ui";
import { ServerSvgIcon } from "../plugins/ServerSvgIcon";
import { OptionSheet, type PickerOption } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";

export interface ProviderPickerProps {
  options: readonly ProviderPickerOption[];
  value: string;
  onChange: (providerId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

/**
 * Agent provider (Codex, Claude, …) picker. Provider logos come from the
 * server (`GET /system/providers/:id/logo`, `currentColor` SVGs) painted in
 * the theme foreground; a provider without a logo gets the Zap glyph.
 */
export function ProviderPicker({
  options,
  value,
  onChange,
  disabled,
  loading,
  testID = "provider-picker",
}: ProviderPickerProps) {
  const sheet = useSheet();
  const { tokens } = useTheme();
  const rows = useMemo(
    (): PickerOption[] =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        icon: "Zap",
        leading:
          option.logoUrl === null ? undefined : (
            <ServerSvgIcon
              path={option.logoUrl}
              fallbackIcon="Zap"
              size={20}
              color={
                option.available ? tokens.foreground : tokens.subtleForeground
              }
            />
          ),
        description: option.available
          ? undefined
          : "Not available on this machine",
      })),
    [options, tokens.foreground, tokens.subtleForeground],
  );
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <PickerTrigger
        icon="Zap"
        leading={
          selected?.logoUrl ? (
            <ServerSvgIcon
              path={selected.logoUrl}
              fallbackIcon="Zap"
              size={16}
              color={tokens.pillIcon}
            />
          ) : undefined
        }
        label={selected?.label ?? (loading ? "Provider…" : "Provider")}
        onPress={sheet.present}
        disabled={disabled || options.length === 0}
        loading={loading}
        testID={testID}
        accessibilityLabel="Provider"
      />
      <OptionSheet
        controller={sheet}
        title="Provider"
        options={rows}
        value={value}
        onChange={onChange}
        testIDPrefix={`${testID}-option`}
        emptyMessage="No providers configured on the server."
      />
    </>
  );
}
