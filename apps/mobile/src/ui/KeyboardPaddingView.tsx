import { useEffect, useState, type ReactNode } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  useWindowDimensions,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Gap kept between a composer and the open keyboard. */
export const COMPOSER_KEYBOARD_GAP = 8;

export interface KeyboardPaddingViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Extra bottom padding while the keyboard is open, so a composer that sits
   * on the home-indicator inset when the keyboard is closed keeps a small gap
   * above the keyboard instead of touching it. Defaults to 0.
   */
  keyboardGap?: number;
  testID?: string;
}

/**
 * Bottom-anchored container whose bottom padding follows the keyboard, so its
 * children shrink and a list above a composer stays anchored. Driven by plain
 * React state from the iOS `keyboardWillChangeFrame` events (animated with
 * the keyboard's own curve through LayoutAnimation), not by a Reanimated
 * style: both react-native-keyboard-controller's `KeyboardAvoidingView` and
 * a shared-value-driven padding were seen keeping a keyboard-sized gap after
 * a sheet's text input closed while the screen re-rendered (the final
 * "keyboard hidden" style update was lost). Meant for views that reach the
 * bottom edge of the window: the bottom safe-area inset is subtracted
 * because the keyboard covers it. iOS only for now: Android resizes the
 * window itself (`adjustResize`), so the padding would double.
 */
export function KeyboardPaddingView({
  children,
  style,
  keyboardGap = 0,
  testID,
}: KeyboardPaddingViewProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const [paddingBottom, setPaddingBottom] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const apply = (event: KeyboardEvent, keyboardScreenY: number) => {
      const keyboardHeight = Math.max(0, windowHeight - keyboardScreenY);
      // The keyboard covers the home-indicator inset the content already pads;
      // `keyboardGap` keeps a little of it as a gap above the keyboard.
      const next =
        keyboardHeight > 0
          ? Math.max(0, keyboardHeight - bottomInset + keyboardGap)
          : 0;
      if (event.duration > 0) {
        LayoutAnimation.configureNext({
          duration: event.duration,
          update: {
            type: LayoutAnimation.Types[event.easing] ?? "keyboard",
          },
        });
      }
      setPaddingBottom(next);
    };
    const subscriptions = [
      Keyboard.addListener("keyboardWillChangeFrame", (event) =>
        apply(event, event.endCoordinates.screenY),
      ),
      // Belt and braces: a hide always lands on zero even if the frame
      // event reported a still-visible keyboard (interactive dismiss).
      Keyboard.addListener("keyboardWillHide", (event) =>
        apply(event, windowHeight),
      ),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [bottomInset, keyboardGap, windowHeight]);

  return (
    <View style={[style, { paddingBottom }]} testID={testID}>
      {children}
    </View>
  );
}
