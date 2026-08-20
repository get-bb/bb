import { View } from "react-native";
import { useTheme } from "@/theme";
import { Button, Spinner, Text } from "@/ui";
import type { ComposerVoiceController } from "./useComposerVoice";

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Replaces the footer while recording / transcribing (web `VoiceRecordingBar`). */
export function VoiceBar({ voice }: { voice: ComposerVoiceController }) {
  const { tokens } = useTheme();
  const recording = voice.state === "recording";
  return (
    <View
      className="flex-row items-center gap-3 px-2 py-1"
      testID="composer-voice-bar"
    >
      <Button
        variant="ghost"
        size="icon"
        icon="X"
        accessibilityLabel="Cancel voice input"
        onPress={voice.cancel}
        testID="composer-voice-cancel"
      />
      <View className="flex-1 flex-row items-center gap-2">
        {recording ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: tokens.destructive,
            }}
          />
        ) : (
          <Spinner />
        )}
        <Text variant="label">
          {recording ? "Listening…" : "Transcribing…"}
        </Text>
        {recording ? (
          <Text variant="caption" mono>
            {formatElapsed(voice.elapsedSeconds)}
          </Text>
        ) : null}
      </View>
      {recording ? (
        <Button
          size="icon"
          icon="Check"
          accessibilityLabel="Stop and transcribe"
          haptic
          onPress={() => void voice.stop()}
          testID="composer-voice-stop"
        />
      ) : null}
    </View>
  );
}
