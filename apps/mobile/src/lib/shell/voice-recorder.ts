import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";

const SPEECH_RECORDING = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
};

let recorder: AudioRecorder | null = null;

async function setRecordingMode(allowsRecording: boolean): Promise<void> {
  await setAudioModeAsync({
    allowsRecording,
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
  });
}

async function closeRecorder(): Promise<string | null> {
  const current = recorder;
  recorder = null;
  if (current === null) return null;
  try {
    await current.stop();
    return current.uri;
  } finally {
    current.release();
    await setRecordingMode(false);
  }
}

export async function startVoiceRecording(): Promise<void> {
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error("Microphone permission denied");
  const stale = await closeRecorder();
  if (stale !== null) new File(stale).delete();
  await setRecordingMode(true);
  const next = new AudioModule.AudioRecorder(SPEECH_RECORDING);
  await next.prepareToRecordAsync();
  next.record();
  recorder = next;
}

export async function stopVoiceRecording(): Promise<{
  base64: string;
  mimeType: string;
}> {
  const uri = await closeRecorder();
  if (uri === null) throw new Error("No voice recording is running");
  const file = new File(uri);
  try {
    return { base64: await file.base64(), mimeType: "audio/mp4" };
  } finally {
    file.delete();
  }
}
