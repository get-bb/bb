import { useEffect, useRef, useState } from "react";
import {
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "@/theme";
import {
  buildWaveformPath,
  idleWaveformBars,
  pushWaveformBar,
  trimWaveformBars,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_EDGE_FADE_FRACTION,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  waveformBarCount,
} from "./voice-waveform-model";

export interface VoiceWaveformProps {
  /**
   * Reads the current input level as a bar amplitude in `0..1` (see
   * `meteringToAmplitude`). Called ~30× per second while `active`.
   */
  readLevel: () => number;
  /** Sample and scroll while true; freeze the last bars while false. */
  active: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The scrolling sound-wave bars from the web `WaveformVisualizer`: one bar per
 * sample, newest at the right edge, older bars fading out on the left. Drawn
 * as one SVG path so a frame is a single prop update. With reduce-motion on
 * (or before any sample) it shows the flat idle bars.
 */
export function VoiceWaveform({
  readLevel,
  active,
  style,
  testID,
}: VoiceWaveformProps) {
  const { tokens } = useTheme();
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const barsRef = useRef<number[]>([]);
  const [path, setPath] = useState("");
  const readLevelRef = useRef(readLevel);
  useEffect(() => {
    readLevelRef.current = readLevel;
  }, [readLevel]);

  const { width, height } = size;
  const barCount = waveformBarCount(width);
  const animate = active && !reduceMotion && width > 0;

  useEffect(() => {
    if (width <= 0) return;
    if (barsRef.current.length === 0) {
      barsRef.current = idleWaveformBars(barCount);
    } else {
      barsRef.current = trimWaveformBars(barsRef.current, barCount);
    }
    setPath(buildWaveformPath(barsRef.current, width, height));
    if (!animate) return;
    const timer = setInterval(() => {
      const amplitude = readLevelRef.current();
      barsRef.current = pushWaveformBar(barsRef.current, amplitude, barCount);
      setPath(buildWaveformPath(barsRef.current, width, height));
    }, WAVEFORM_SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [animate, barCount, height, width]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setSize((prev) =>
      prev.width === next.width && prev.height === next.height
        ? prev
        : { width: next.width, height: next.height },
    );
  };

  return (
    <View
      style={[{ flex: 1, alignSelf: "stretch" }, style]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {width > 0 && height > 0 ? (
        <Svg width={width} height={height} pointerEvents="none">
          <Defs>
            <LinearGradient
              id="bb-voice-waveform-fade"
              x1="0"
              y1="0"
              x2={String(width * WAVEFORM_EDGE_FADE_FRACTION)}
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <Stop
                offset="0"
                stopColor={tokens.foreground}
                stopOpacity={0.15}
              />
              <Stop offset="1" stopColor={tokens.foreground} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Path
            d={path}
            stroke="url(#bb-voice-waveform-fade)"
            strokeWidth={WAVEFORM_BAR_WIDTH}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      ) : null}
    </View>
  );
}
