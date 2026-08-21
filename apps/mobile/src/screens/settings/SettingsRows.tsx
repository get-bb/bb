import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Spinner, Switch, Text, type IconName } from "@/ui";

/**
 * The settings screens' building blocks: a titled card of rows
 * (`SettingsSection`), a label + description + control row
 * (`SettingsControlRow`), and the switch row on top of it. Mirrors the web
 * `SettingsSection` / `SettingsWithControl` at touch size.
 */

export interface SettingsSectionProps {
  title?: string;
  description?: string;
  /** Right-hand slot next to the title (a refresh button, a picker). */
  action?: ReactNode;
  children: ReactNode;
  /** Quiet line below the card. */
  footnote?: string;
  testID?: string;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  footnote,
  testID,
}: SettingsSectionProps) {
  return (
    <View className="gap-1" testID={testID}>
      {title || action ? (
        <View className="flex-row items-center justify-between gap-3 pb-1">
          {title ? <Text variant="sectionLabel">{title}</Text> : <View />}
          {action}
        </View>
      ) : null}
      {description ? (
        <Text variant="caption" className="pb-2">
          {description}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </View>
      {footnote ? (
        <Text variant="caption" className="pt-1">
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

interface SettingsControlRowProps {
  label: string;
  description?: string;
  /** Small pill after the label ("dev-only", "Installed"). */
  badge?: string;
  /** The control on the right (switch, button, picker trigger). */
  control?: ReactNode;
  /** Leading glyph. */
  icon?: IconName;
  /** Make the whole row pressable (opens the control's picker). */
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Let the control take the remaining width (a long value that truncates)
   * instead of the label column.
   */
  controlGrows?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

export function SettingsControlRow({
  label,
  description,
  badge,
  control,
  icon,
  onPress,
  disabled = false,
  controlGrows = false,
  testID,
  accessibilityLabel,
}: SettingsControlRowProps) {
  const { tokens } = useTheme();
  const body = (
    <>
      {icon ? <Icon name={icon} size={20} color={tokens.foreground} /> : null}
      <View
        className="min-w-0 flex-1 gap-0.5"
        style={controlGrows ? { flexGrow: 3 } : undefined}
      >
        <View className="flex-row items-center gap-2">
          <Text variant="body" numberOfLines={2} className="shrink">
            {label}
          </Text>
          {badge ? (
            <View className="rounded-sm border border-border bg-secondary px-1.5 py-px">
              <Text variant="chrome" numberOfLines={1}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        {description ? <Text variant="caption">{description}</Text> : null}
      </View>
      {control ? (
        <View
          className={controlGrows ? "min-w-0 flex-1 items-end" : "shrink-0"}
          style={controlGrows ? { flexGrow: 2 } : undefined}
        >
          {control}
        </View>
      ) : null}
    </>
  );
  const className = cn(
    "min-h-[44px] flex-row items-center gap-3 px-4 py-2.5",
    disabled && "opacity-50",
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        className={cn(className, "active:bg-state-hover")}
        testID={testID}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View className={className} testID={testID}>
      {body}
    </View>
  );
}

interface SettingsSwitchRowProps {
  label: string;
  description?: string;
  badge?: string;
  icon?: IconName;
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
  badge,
  icon,
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
      badge={badge}
      icon={icon}
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

interface SettingsValueRowProps {
  label: string;
  value: string;
  description?: string;
  icon?: IconName;
  onPress?: () => void;
  disabled?: boolean;
  /** Paint the value in the warning tone (offline, fallback). */
  tone?: "default" | "warning" | "destructive";
  testID?: string;
}

/** Label on the left, the current value + a chevron on the right (opens a picker). */
export function SettingsValueRow({
  label,
  value,
  description,
  icon,
  onPress,
  disabled,
  tone = "default",
  testID,
}: SettingsValueRowProps) {
  const { tokens } = useTheme();
  const color =
    tone === "warning"
      ? tokens.warningText
      : tone === "destructive"
        ? tokens.destructiveText
        : tokens.mutedForeground;
  return (
    <SettingsControlRow
      label={label}
      description={description}
      icon={icon}
      onPress={onPress}
      disabled={disabled}
      controlGrows
      testID={testID}
      accessibilityLabel={`${label}: ${value}`}
      control={
        <View className="min-w-0 flex-row items-center gap-1">
          <Text
            variant="body"
            numberOfLines={1}
            className="min-w-0 shrink text-right"
            style={{ color }}
          >
            {value}
          </Text>
          {onPress ? (
            <Icon
              name="ChevronRight"
              size={18}
              color={tokens.subtleForeground}
            />
          ) : null}
        </View>
      }
    />
  );
}

/** Inline hint card for a host-dependent screen that cannot work right now. */
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
    <View
      className="gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3"
      testID={testID}
    >
      <Text variant="label">{title}</Text>
      <Text variant="caption">{message}</Text>
    </View>
  );
}
