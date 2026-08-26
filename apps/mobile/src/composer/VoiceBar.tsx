import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import { Button, Icon, Spinner } from "@/ui";
import type { ComposerVoiceController } from "./useComposerVoice";
import { VoiceWaveform } from "./VoiceWaveform";

const IS_IOS = process.env.EXPO_OS === "ios";
/** iOS: the filled circle symbols are the buttons. */
const SYMBOL_BUTTON = 36;
const SYMBOL_SIZE = 32;

export type VoiceBarController = Pick<
  ComposerVoiceController,
  "state" | "readLevel" | "stop" | "cancel"
>;

/**
 * Replaces the footer while recording / transcribing (web `VoiceRecordingBar`):
 * cancel · the live sound-wave bars · confirm. While transcribing the bars
 * freeze and breathe (the web `animate-shine-icon`) and the confirm button
 * shows a spinner. iOS draws the two buttons as the system's filled circle
 * symbols (`xmark.circle.fill` / `arrow.up.circle.fill`).
 */
export function VoiceBar({ voice }: { voice: VoiceBarController }) {
  const { tokens } = useTheme();
  const transcribing = voice.state === "transcribing";
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!transcribing) {
      opacity.set(withTiming(1, { duration: 150 }));
      return;
    }
    opacity.set(
      withRepeat(
        withSequence(
          withTiming(0.35, { duration: 700 }),
          withTiming(1, { duration: 700 }),
        ),
        -1,
      ),
    );
  }, [opacity, transcribing]);
  const breathe = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const cancelLabel = transcribing
    ? "Cancel transcription"
    : "Cancel recording";
  const stopLabel = transcribing
    ? "Transcribing voice input"
    : "Stop and transcribe";
  const stop = () => {
    haptic("impact-medium");
    void voice.stop();
  };

  return (
    <View
      className="flex-row items-center gap-2 px-2 py-1"
      accessibilityLiveRegion="polite"
      accessibilityLabel={transcribing ? "Transcribing" : "Recording"}
      testID="composer-voice-bar"
    >
      {IS_IOS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          hitSlop={4}
          onPress={voice.cancel}
          className="items-center justify-center active:opacity-60"
          style={{ width: SYMBOL_BUTTON, height: SYMBOL_BUTTON }}
          testID="composer-voice-cancel"
        >
          <Icon
            name="CircleX"
            symbol="xmark.circle.fill"
            size={SYMBOL_SIZE}
            color={tokens.mutedForeground}
          />
        </Pressable>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          icon="X"
          className="rounded-full"
          accessibilityLabel={cancelLabel}
          onPress={voice.cancel}
          testID="composer-voice-cancel"
        />
      )}
      <Animated.View
        style={[{ flex: 1, minWidth: 0, height: 28 }, breathe]}
        testID="composer-voice-waveform"
      >
        <VoiceWaveform readLevel={voice.readLevel} active={!transcribing} />
      </Animated.View>
      {IS_IOS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stopLabel}
          accessibilityState={{ busy: transcribing }}
          hitSlop={4}
          disabled={transcribing}
          onPress={stop}
          className="items-center justify-center active:opacity-60"
          style={{ width: SYMBOL_BUTTON, height: SYMBOL_BUTTON }}
          testID="composer-voice-stop"
        >
          {transcribing ? (
            <Spinner color={tokens.primary} />
          ) : (
            <Icon
              name="ArrowUp"
              symbol="arrow.up.circle.fill"
              size={SYMBOL_SIZE}
              color={tokens.primary}
            />
          )}
        </Pressable>
      ) : (
        <Button
          size="icon"
          icon="Check"
          className="rounded-full"
          accessibilityLabel={stopLabel}
          loading={transcribing}
          haptic
          onPress={() => void voice.stop()}
          testID="composer-voice-stop"
        />
      )}
    </View>
  );
}
