import { useCallback, useEffect, useState } from "react";

export interface AudioInputDeviceOption {
  deviceId: string;
  label: string;
}

interface RefreshAudioInputDevicesOptions {
  requestPermission?: boolean;
}

const DEFAULT_AUDIO_INPUT_DEVICE_ID = "default";

function getMediaDevices(): MediaDevices | null {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return null;
  }
  return navigator.mediaDevices;
}

function resolveAudioInputDeviceErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone permission denied";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No microphones found";
      default:
        return "Microphone devices unavailable";
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "Microphone devices unavailable";
}

function audioInputDeviceLabel(
  device: Pick<MediaDeviceInfo, "label">,
  index: number,
): string {
  const label = device.label.trim();
  return label.length > 0 ? label : `Microphone ${index + 1}`;
}

export function audioInputDeviceOptions(
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
): AudioInputDeviceOption[] {
  const seenDeviceIds = new Set<string>();
  const options: AudioInputDeviceOption[] = [];

  for (const device of devices) {
    if (
      device.kind !== "audioinput" ||
      device.deviceId.length === 0 ||
      device.deviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID ||
      seenDeviceIds.has(device.deviceId)
    ) {
      continue;
    }

    seenDeviceIds.add(device.deviceId);
    options.push({
      deviceId: device.deviceId,
      label: audioInputDeviceLabel(device, options.length),
    });
  }

  return options;
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useAudioInputDevices() {
  const [devices, setDevices] = useState<AudioInputDeviceOption[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasDeviceAccess, setHasDeviceAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSupported, setIsSupported] = useState(
    () => getMediaDevices() !== null,
  );

  const refresh = useCallback(
    async (options: RefreshAudioInputDevicesOptions = {}) => {
      const mediaDevices = getMediaDevices();
      setIsSupported(mediaDevices !== null);
      if (mediaDevices === null) {
        setDevices([]);
        setErrorMessage(null);
        return;
      }

      setIsLoading(true);
      let permissionStream: MediaStream | null = null;
      try {
        if (options.requestPermission) {
          permissionStream = await mediaDevices.getUserMedia({ audio: true });
        }
        const availableDevices = await mediaDevices.enumerateDevices();
        if (
          permissionStream ||
          availableDevices.some(
            (device) => device.kind === "audioinput" && device.label.length > 0,
          )
        ) {
          setHasDeviceAccess(true);
        }
        setDevices(audioInputDeviceOptions(availableDevices));
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(resolveAudioInputDeviceErrorMessage(error));
      } finally {
        stopMediaStream(permissionStream);
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const mediaDevices = getMediaDevices();
    setIsSupported(mediaDevices !== null);
    if (mediaDevices === null) {
      return;
    }

    void refresh();

    const handleDeviceChange = () => {
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", handleDeviceChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      window.removeEventListener("focus", handleDeviceChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  return {
    devices,
    hasDeviceAccess,
    errorMessage,
    isLoading,
    isSupported,
    refresh,
  };
}
