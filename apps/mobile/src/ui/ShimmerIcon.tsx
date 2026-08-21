import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Icon, type IconName } from "./Icon";

export interface ShimmerIconProps {
  name: IconName;
  /** Pixel size; defaults to 14 (the chip / row glyph size). */
  size?: number;
  /** Glyph color; defaults to the current `foreground` token. */
  color?: string;
  /** Animate (default true); false renders the plain glyph. */
  active?: boolean;
}

/** Web `--shine-icon-edge-opacity`: the glyph outside the bright band. */
const EDGE_OPACITY = 0.45;
/** Web `.animate-shine-icon` cycle. */
const SWEEP_DURATION_MS = 2600;
/** Band widths as a share of the glyph: a soft halo and a bright core. */
const HALO_WIDTH_RATIO = 0.9;
const CORE_WIDTH_RATIO = 0.4;
const HALO_OPACITY = 0.75;

/**
 * Glyph with the web `.animate-shine-icon` treatment for live activity
 * (running commands, workflows): the glyph sits at 45 % opacity and a
 * bright band sweeps across it. React Native has no CSS mask, so the band
 * is a clipped window that moves over the glyph while a second copy of the
 * glyph inside the window moves the opposite way, so the two copies stay
 * aligned. A wider, dimmer window behind the bright one softens the edges
 * the way the web gradient does.
 */
export function ShimmerIcon({
  name,
  size = 14,
  color,
  active = true,
}: ShimmerIconProps) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      progress.set(0);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(
        withTiming(1, { duration: SWEEP_DURATION_MS, easing: Easing.linear }),
        -1,
      ),
    );
  }, [active, progress]);

  if (!active) {
    return <Icon name={name} size={size} color={color} />;
  }
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ opacity: EDGE_OPACITY }}>
        <Icon name={name} size={size} color={color} />
      </View>
      <SweepBand
        name={name}
        size={size}
        color={color}
        bandWidth={size * HALO_WIDTH_RATIO}
        opacity={HALO_OPACITY}
        progress={progress}
      />
      <SweepBand
        name={name}
        size={size}
        color={color}
        bandWidth={size * CORE_WIDTH_RATIO}
        opacity={1}
        progress={progress}
      />
    </View>
  );
}

function SweepBand({
  name,
  size,
  color,
  bandWidth,
  opacity,
  progress,
}: {
  name: IconName;
  size: number;
  color: string | undefined;
  bandWidth: number;
  opacity: number;
  progress: SharedValue<number>;
}) {
  // The band travels from fully left of the glyph to fully right of it.
  const travel = size + bandWidth;
  const windowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -bandWidth + progress.get() * travel }],
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bandWidth - progress.get() * travel }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          width: bandWidth,
          height: size,
          overflow: "hidden",
          opacity,
        },
        windowStyle,
      ]}
    >
      <Animated.View style={[{ width: size, height: size }, glyphStyle]}>
        <Icon name={name} size={size} color={color} />
      </Animated.View>
    </Animated.View>
  );
}
