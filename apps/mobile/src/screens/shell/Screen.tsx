import type { ReactNode } from "react";
import { ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionBanner } from "./ConnectionBanner";

interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (default). Lists supply their own. */
  scroll?: boolean;
  /**
   * Overrides for the scroll content container (default 16px padding, 24px
   * gap). Plain styles: react-native-css drops `contentContainerClassName`
   * when an inline `contentContainerStyle` is also present.
   */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Themed screen container under a native header: connection banner on top,
 * then either scrolling content or a raw flex column for screens that
 * manage their own list.
 */
export function Screen({
  children,
  scroll = true,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background" testID={testID}>
      <ConnectionBanner />
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={[
            { padding: 16, gap: 24, paddingBottom: insets.bottom + 32 },
            contentStyle,
          ]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}
    </View>
  );
}
