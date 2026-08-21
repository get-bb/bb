import { Link, Stack } from "expo-router";
import { View } from "react-native";
import { Text } from "@/ui";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Text variant="heading">This screen does not exist.</Text>
        <Link href="/">
          <Text tone="primary">Go home</Text>
        </Link>
      </View>
    </>
  );
}
