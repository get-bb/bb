import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Text, type TextProps } from "./Text";

export interface ShimmerTextProps extends TextProps {
  /** Animate (default true); false renders plain text with no animation. */
  active?: boolean;
  /** Style of the animated wrapper (flex sizing inside a row). */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Text with the web `animate-shine` treatment for in-progress labels
 * ("Working…", the active bundle verb): a slow opacity breathe on a wrapper
 * view instead of the CSS gradient sweep, which RN text cannot mask cheaply.
 */
export function ShimmerText({
  active = true,
  containerStyle,
  ...props
}: ShimmerTextProps) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!active) {
      opacity.set(withTiming(1, { duration: 150 }));
      return;
    }
    opacity.set(
      withRepeat(
        withSequence(
          withTiming(0.45, { duration: 700 }),
          withTiming(1, { duration: 700 }),
        ),
        -1,
      ),
    );
  }, [active, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[containerStyle, animated]}>
      <Text {...props} />
    </Animated.View>
  );
}
