import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, ListRow, Separator, Text, type IconName } from "@/ui";

export function SheetHeader({
  title,
  message,
}: {
  title: string;
  message?: string | null;
}) {
  return (
    <>
      <View className="gap-1 px-4 pb-3 pt-1">
        <Text variant="heading" numberOfLines={2}>
          {title}
        </Text>
        {message ? <Text variant="caption">{message}</Text> : null}
      </View>
      <Separator />
    </>
  );
}

export function CheckRow({
  label,
  icon,
  checked,
  onPress,
  testID,
}: {
  label: string;
  icon: IconName;
  checked: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <ListRow
      title={label}
      leading={icon}
      selected={checked}
      trailing={
        checked ? (
          <Icon name="Check" size={18} color={tokens.foreground} />
        ) : null
      }
      onPress={onPress}
      testID={testID}
    />
  );
}

/** Full-width secondary row with centered copy (Cancel / Done). */
export function CenteredRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-[44px] items-center justify-center px-4 active:bg-state-hover"
      testID={testID}
    >
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}
