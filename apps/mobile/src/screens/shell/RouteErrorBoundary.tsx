import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Fallback for uncaught render errors (exported as `ErrorBoundary` from the
 * root layout). Deliberately theme-free: it renders when the providers
 * themselves may have failed.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#fff" }}
      contentContainerStyle={{
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 12,
      }}
      testID="route-error"
    >
      <Text style={{ fontSize: 20, fontWeight: "600", color: "#111" }}>
        Something went wrong
      </Text>
      <Text selectable style={{ color: "#444", fontFamily: "Menlo" }}>
        {error.message}
      </Text>
      <View style={{ flexDirection: "row" }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void retry()}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#333" : "#111",
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 8,
          })}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Try again</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
