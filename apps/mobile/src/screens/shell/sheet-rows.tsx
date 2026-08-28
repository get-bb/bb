import { Pressable, View } from "react-native";
import { cn, ListRow, Separator, Text, type IconName } from "@/ui";

const IS_IOS = process.env.EXPO_OS === "ios";

export function SheetHeader({
  title,
  message,
}: {
  title: string;
  message?: string | null;
}) {
  return (
    <>
      <View className="items-center gap-0.5 px-4 pb-3 pt-1">
        <Text variant="heading" numberOfLines={2} className="text-center">
          {title}
        </Text>
        {message ? (
          <Text variant="caption" numberOfLines={2} className="text-center">
            {message}
          </Text>
        ) : null}
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
  return (
    <ListRow
      title={label}
      leading={icon}
      selected={checked}
      onPress={onPress}
      testID={testID}
    />
  );
}

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
      className={cn(
        "min-h-[44px] items-center justify-center px-4",
        IS_IOS ? "active:bg-state-active" : "active:bg-state-hover",
      )}
      testID={testID}
    >
      <Text variant="bodyLarge" weight="semibold" tone="primary">
        {label}
      </Text>
    </Pressable>
  );
}
