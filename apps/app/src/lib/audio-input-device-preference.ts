import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createLocalStorageSyncStorage } from "./browser-storage";

const AUDIO_INPUT_DEVICE_STORAGE_KEY = "bb.voiceInput.audioInputDeviceId";

export type PreferredAudioInputDeviceId = string | null;

const MAX_AUDIO_INPUT_DEVICE_ID_LENGTH = 1024;

function isStoredAudioInputDeviceId(
  value: string,
): value is NonNullable<PreferredAudioInputDeviceId> {
  return (
    value.trim().length > 0 && value.length <= MAX_AUDIO_INPUT_DEVICE_ID_LENGTH
  );
}

export function parsePreferredAudioInputDeviceId(
  storedValue: string | null,
  initialValue: PreferredAudioInputDeviceId,
): PreferredAudioInputDeviceId {
  if (storedValue === null) {
    return initialValue;
  }
  return isStoredAudioInputDeviceId(storedValue) ? storedValue : initialValue;
}

const audioInputDeviceStorage =
  createLocalStorageSyncStorage<PreferredAudioInputDeviceId>({
    parse: parsePreferredAudioInputDeviceId,
    serialize: (value) => value ?? "",
  });

const audioInputDevicePreferenceAtom =
  atomWithStorage<PreferredAudioInputDeviceId>(
    AUDIO_INPUT_DEVICE_STORAGE_KEY,
    null,
    audioInputDeviceStorage,
    { getOnInit: true },
  );

export function buildAudioInputConstraints(
  preferredDeviceId: PreferredAudioInputDeviceId,
): MediaStreamConstraints {
  if (preferredDeviceId === null) {
    return { audio: true };
  }

  return {
    audio: {
      deviceId: { exact: preferredDeviceId },
    },
  };
}

function canTryAnotherMicrophone(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    [
      "OverconstrainedError",
      "NotFoundError",
      "DevicesNotFoundError",
      "NotReadableError",
      "TrackStartError",
    ].includes(error.name)
  );
}

export async function requestAudioInputStream(
  mediaDevices: Pick<MediaDevices, "getUserMedia" | "enumerateDevices">,
  preferredDeviceId: PreferredAudioInputDeviceId,
): Promise<MediaStream> {
  let lastError: unknown;
  const candidates =
    preferredDeviceId === null ? [null] : [preferredDeviceId, null];
  for (const deviceId of candidates) {
    try {
      return await mediaDevices.getUserMedia(
        buildAudioInputConstraints(deviceId),
      );
    } catch (error) {
      if (!canTryAnotherMicrophone(error)) throw error;
      lastError = error;
    }
  }
  const devices = await mediaDevices.enumerateDevices();
  const tried = new Set([preferredDeviceId, "default", ""]);
  for (const device of devices) {
    if (device.kind !== "audioinput" || tried.has(device.deviceId)) continue;
    tried.add(device.deviceId);
    try {
      return await mediaDevices.getUserMedia(
        buildAudioInputConstraints(device.deviceId),
      );
    } catch (error) {
      if (!canTryAnotherMicrophone(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export function useAudioInputDevicePreference() {
  return useAtom(audioInputDevicePreferenceAtom);
}

export function useAudioInputDevicePreferenceValue() {
  return useAtomValue(audioInputDevicePreferenceAtom);
}
