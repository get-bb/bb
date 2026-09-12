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

export interface SettingsSectionProps {
  title?: string;
  children: ReactNode;
  footnote?: string | ReactNode;
  separatorInset?: GroupedSectionProps["separatorInset"];
  testID?: string;
}

export function SettingsSection({
  title,
  children,
  footnote,
  separatorInset,
  testID,
}: SettingsSectionProps) {
  return (
    <GroupedSection
      title={title}
      footer={footnote}
      separatorInset={separatorInset}
      testID={testID}
    >
      {children}
    </GroupedSection>
  );
}

export interface SettingsSwitchRowProps {
  label: string;
  badge?: GroupedRowProps["badge"];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  pending?: boolean;
  testID?: string;
}

export function SettingsSwitchRow({
  label,
  badge,
  checked,
  onCheckedChange,
  disabled = false,
  pending = false,
  testID,
}: SettingsSwitchRowProps) {
  const { tokens } = useTheme();
  return (
    <GroupedRow
      title={label}
      badge={badge}
      trailing={
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
      titleLines={2}
      accessibilityLabel={label}
    />
  );
}

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

export const ICON_ROW_SEPARATOR_INSET = 16 + 20 + 12;

export interface HeaderIconButtonProps {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

export function HeaderIconButton({
  icon,
  accessibilityLabel,
  onPress,
  testID,
}: HeaderIconButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      testID={testID}
    >
      <Icon
        name={icon}
        size={22}
        color={IS_IOS ? tokens.primary : tokens.foreground}
      />
    </Pressable>
  );
}
