import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ConnectionBanner } from "./ConnectionBanner";

const IS_IOS = process.env.EXPO_OS === "ios";

/** Gap between the header's bottom edge and a floating banner. */
const FLOATING_BANNER_GAP = 8;

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
  /**
   * Whether the screen shows the connection banner (default). Pass `false`
   * when the screen places `<ConnectionBanner />` itself — list screens
   * render it as their list header so it scrolls with the rows.
   */
  banner?: boolean;
  /**
   * Page color painted on the outer view (so the header inset and overscroll
   * regions match the content): the canvas (default) or the iOS grouped page
   * behind inset cards.
   */
  surface?: "background" | "grouped";
  testID?: string;
}

/**
 * Themed screen container under a native header. The scroll view is the
 * screen's first child and adjusts for the header itself
 * (`contentInsetAdjustmentBehavior="automatic"`: that is what drives the
 * large-title collapse and the material bar on iOS), with the connection
 * banner as the first item of the content. Screens that manage their own
 * list (`scroll={false}`) must pass `contentInsetAdjustmentBehavior`
 * themselves and keep the list their first child; the banner then floats
 * under the header on iOS and sits above the list on Android.
 */
export function Screen({
  children,
  scroll = true,
  contentStyle,
  banner = true,
  surface = "background",
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const rootClassName =
    surface === "grouped"
      ? "flex-1 bg-surface-grouped"
      : "flex-1 bg-background";
  if (scroll) {
    return (
      <ScrollView
        className={rootClassName}
        testID={testID}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          {
            padding: 16,
            gap: 24,
            // iOS already adds the home-indicator inset through the
            // automatic content inset adjustment.
            paddingBottom: IS_IOS ? 32 : insets.bottom + 32,
          },
          contentStyle,
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {banner ? <ConnectionBanner /> : null}
        {children}
      </ScrollView>
    );
  }
  // `collapsable={false}`: Fabric would otherwise flatten this root into a
  // childless sibling (it keeps a leaf for the background + testID and hoists
  // the content next to it), and UIKit / react-native-screens look for the
  // screen's scroll view along the first-subview chain — with the leaf first,
  // the large title never collapses and the bar never gets its edge effect.
  return (
    <View className={rootClassName} testID={testID} collapsable={false}>
      {banner && !IS_IOS ? <ConnectionBanner inset /> : null}
      <View className="flex-1">{children}</View>
      {banner && IS_IOS ? <FloatingConnectionBanner /> : null}
    </View>
  );
}

/**
 * iOS: the header is translucent and the content runs under it, so a banner
 * laid out at the top of a list screen would hide behind the bar — and
 * laying it out above the list would take the list out of the header's
 * first-subview slot that drives large titles and the scroll-edge material.
 * The banner floats instead. A SafeAreaProvider of its own reports the bar
 * (status bar + navigation bar, large title included) as its top inset —
 * the same inset UIKit hands the list — so the card sits just under it
 * without measuring header heights. Touches pass through everywhere but
 * the card.
 */
function FloatingConnectionBanner() {
  return (
    <SafeAreaProvider style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <FloatingConnectionBannerBody />
    </SafeAreaProvider>
  );
}

function FloatingConnectionBannerBody() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: insets.top + FLOATING_BANNER_GAP,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
      }}
    >
      <ConnectionBanner />
    </View>
  );
}
