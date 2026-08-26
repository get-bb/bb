import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import {
  GroupedRow,
  GroupedSection,
  Icon,
  Spinner,
  Switch,
  Text,
  type GroupedRowProps,
  type GroupedSectionProps,
  type IconName,
} from "@/ui";

const IS_IOS = process.env.EXPO_OS === "ios";

/*
 * The settings screens' building blocks, thin wrappers over the iOS
 * inset-grouped primitives (`GroupedSection` / `GroupedRow` / `IconBadge`
 * in @/ui): a titled card of rows (`SettingsSection`), a label + control
 * row (`SettingsControlRow`), the switch row and the value row on top of
 * it. Wrapper rows keep the `leading` / `badge` prop names so the section
 * can inset its separators to the text column.
 */

export interface SettingsSectionProps {
  title?: string;
  /** Copy between the header and the card; prefer `footnote` (iOS footer). */
  description?: string;
  /** Right-hand slot next to the title (a refresh button, a picker). */
  action?: ReactNode;
  children: ReactNode;
  /** Footnote under the card: help copy, or a toned node for warnings. */
  footnote?: string | ReactNode;
  separatorInset?: GroupedSectionProps["separatorInset"];
  className?: string;
  testID?: string;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  footnote,
  separatorInset,
  className,
  testID,
}: SettingsSectionProps) {
  return (
    <GroupedSection
      title={title}
      description={description}
      action={action}
      footer={footnote}
      separatorInset={separatorInset}
      className={className}
      testID={testID}
    >
      {children}
    </GroupedSection>
  );
}

export interface SettingsControlRowProps {
  label: string;
  description?: string;
  /** Short state after the label, drawn as the row value ("Installed", "dev-only"). */
  tag?: string;
  /** The control on the right (switch, button, picker trigger). */
  control?: ReactNode;
  /** Leading glyph (an icon name) or node. */
  leading?: GroupedRowProps["leading"];
  /** Tinted square badge (Settings home); wins over `leading`. */
  badge?: GroupedRowProps["badge"];
  /** Make the whole row pressable (opens the control's picker). */
  onPress?: () => void;
  disabled?: boolean;
  /** Lines before the label truncates (default 2). */
  titleLines?: number;
  testID?: string;
  accessibilityLabel?: string;
}

export function SettingsControlRow({
  label,
  description,
  tag,
  control,
  leading,
  badge,
  onPress,
  disabled = false,
  titleLines = 2,
  testID,
  accessibilityLabel,
}: SettingsControlRowProps) {
  return (
    <GroupedRow
      title={label}
      subtitle={description}
      value={tag}
      leading={leading}
      badge={badge}
      trailing={control}
      onPress={onPress}
      disabled={disabled}
      titleLines={titleLines}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
    />
  );
}

export interface SettingsSwitchRowProps {
  label: string;
  description?: string;
  tag?: string;
  leading?: GroupedRowProps["leading"];
  badge?: GroupedRowProps["badge"];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Shows a spinner next to the switch while a write is in flight. */
  pending?: boolean;
  testID?: string;
}

export function SettingsSwitchRow({
  label,
  description,
  tag,
  leading,
  badge,
  checked,
  onCheckedChange,
  disabled = false,
  pending = false,
  testID,
}: SettingsSwitchRowProps) {
  const { tokens } = useTheme();
  return (
    <SettingsControlRow
      label={label}
      description={description}
      tag={tag}
      leading={leading}
      badge={badge}
      control={
        <View className="flex-row items-center gap-2">
          {pending ? (
            <Spinner size="small" color={tokens.mutedForeground} />
          ) : null}
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            accessibilityLabel={label}
            testID={testID}
          />
        </View>
      }
    />
  );
}

export interface SettingsValueRowProps {
  label: string;
  value: string;
  description?: string;
  leading?: GroupedRowProps["leading"];
  badge?: GroupedRowProps["badge"];
  onPress?: () => void;
  disabled?: boolean;
  /** Paint the value in the warning tone (offline, fallback). */
  tone?: "default" | "warning" | "destructive";
  /** Lets the user select/copy the value (data rows). */
  selectable?: boolean;
  testID?: string;
}

/** Label on the left, the current value (+ a chevron when pressable) on the right. */
export function SettingsValueRow({
  label,
  value,
  description,
  leading,
  badge,
  onPress,
  disabled,
  tone = "default",
  selectable = false,
  testID,
}: SettingsValueRowProps) {
  return (
    <GroupedRow
      title={label}
      subtitle={description}
      value={value}
      valueTone={tone}
      leading={leading}
      badge={badge}
      trailing={onPress ? "chevron" : undefined}
      onPress={onPress}
      disabled={disabled}
      selectable={selectable}
      testID={testID}
    />
  );
}

/** Inline note inside a card for a host-dependent screen that cannot work right now. */
export function SettingsHint({
  title,
  message,
  testID,
}: {
  title: string;
  message: string;
  testID?: string;
}) {
  return (
    <View className="gap-0.5 px-4 py-3" testID={testID}>
      <Text variant="bodyLarge">{title}</Text>
      <Text variant="caption">{message}</Text>
    </View>
  );
}

/** Separator inset for rows whose custom `leading` node is a 20px glyph column. */
export const ICON_ROW_SEPARATOR_INSET = 16 + 20 + 12;
/** Separator inset for sections of badge rows that include a wrapper row (no `badge` prop to read). */
export const BADGE_ROW_SEPARATOR_INSET = 16 + 29 + 12;

export interface HeaderIconButtonProps {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /** Replaces the glyph with a spinner. */
  loading?: boolean;
  testID?: string;
}

/**
 * The Android header action: a bare glyph `Pressable` in `headerRight`.
 * iOS screens render `Stack.Toolbar` items instead (native bar buttons
 * cannot carry a `testID`, so the Maestro flows tap them by label).
 */
export function HeaderIconButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: HeaderIconButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={8}
      disabled={disabled || loading}
      onPress={onPress}
      className={disabled ? "opacity-50" : undefined}
      testID={testID}
    >
      {loading ? (
        <Spinner size="small" color={tokens.mutedForeground} />
      ) : (
        <Icon
          name={icon}
          size={22}
          color={IS_IOS ? tokens.primary : tokens.foreground}
        />
      )}
    </Pressable>
  );
}
