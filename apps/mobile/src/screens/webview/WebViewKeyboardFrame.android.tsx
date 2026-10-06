import type { ViewProps } from "react-native";
import {
  KeyboardController,
  useKeyboardHandler,
} from "react-native-keyboard-controller";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

export function WebViewKeyboardFrame({ style, ...props }: ViewProps) {
  const inset = useSharedValue(KeyboardController.state().height);

  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        inset.value = event.height;
      },
      onEnd: (event) => {
        "worklet";
        inset.value = event.height;
      },
    },
    [],
  );

  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: inset.value,
  }));

  return <Animated.View {...props} style={[style, keyboardStyle]} />;
}
