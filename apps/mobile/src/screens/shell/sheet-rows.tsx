import { Pressable, View } from "react-native";
import { cn, ListRow, Separator, Text, type IconName } from "@/ui";

const IS_IOS = process.env.EXPO_OS === "ios";

/** Centered sheet title (headline) with an optional caption, like a UIKit sheet. */
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

/** Single-choice row: the checked one shows the tinted check mark. */
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

/** Full-width row with centered tinted copy (Cancel / Done). */
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
