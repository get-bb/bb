import { View } from "react-native";
import { Separator, Text } from "@/ui";

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
