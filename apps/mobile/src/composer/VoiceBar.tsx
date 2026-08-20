import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Button } from "@/ui";
import type { ComposerVoiceController } from "./useComposerVoice";
import { VoiceWaveform } from "./VoiceWaveform";

export type VoiceBarController = Pick<
  ComposerVoiceController,
  "state" | "readLevel" | "stop" | "cancel"
>;

/**
 * Replaces the footer while recording / transcribing (web `VoiceRecordingBar`):
 * cancel · the live sound-wave bars · confirm. While transcribing the bars
 * freeze and breathe (the web `animate-shine-icon`) and the confirm button
 * shows a spinner.
 */
export function VoiceBar({ voice }: { voice: VoiceBarController }) {
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

  return (
    <View
      className="flex-row items-center gap-2 px-2 py-1"
      accessibilityLiveRegion="polite"
      accessibilityLabel={transcribing ? "Transcribing" : "Recording"}
      testID="composer-voice-bar"
    >
      <Button
        variant="ghost"
        size="icon"
        icon="X"
        className="rounded-full"
        accessibilityLabel={
          transcribing ? "Cancel transcription" : "Cancel recording"
        }
        onPress={voice.cancel}
        testID="composer-voice-cancel"
      />
      <Animated.View
        style={[{ flex: 1, minWidth: 0, height: 28 }, breathe]}
        testID="composer-voice-waveform"
      >
        <VoiceWaveform readLevel={voice.readLevel} active={!transcribing} />
      </Animated.View>
      <Button
        size="icon"
        icon="Check"
        className="rounded-full"
        accessibilityLabel={
          transcribing ? "Transcribing voice input" : "Stop and transcribe"
        }
        loading={transcribing}
        haptic
        onPress={() => void voice.stop()}
        testID="composer-voice-stop"
      />
    </View>
  );
}
