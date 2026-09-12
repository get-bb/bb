import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionBanner } from "../shell/ConnectionBanner";

const IS_IOS = process.env.EXPO_OS === "ios";

interface GroupedScreenProps {
  children: ReactNode;
  testID?: string;
}

export function GroupedScreen({ children, testID }: GroupedScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-surface-grouped"
      testID={testID}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        {
          padding: 16,
          gap: 24,
          paddingBottom: IS_IOS ? 32 : insets.bottom + 32,
        },
        { flexGrow: 1 },
      ]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <ConnectionBanner />
      {children}
    </ScrollView>
  );
}
