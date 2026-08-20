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

export interface KeyboardPaddingViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
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
      // The keyboard covers the home-indicator inset the content already pads.
      const next = Math.max(0, keyboardHeight - bottomInset);
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
  }, [bottomInset, windowHeight]);

  return (
    <View style={[style, { paddingBottom }]} testID={testID}>
      {children}
    </View>
  );
}
