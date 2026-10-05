import { useEffect, useState } from "react";

import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { useAudioInputDevices } from "@/hooks/useAudioInputDevices";
import { useMicrophoneSignal } from "@/hooks/useMicrophoneSignal";
import {
  requestAudioInputStream,
  useAudioInputDevicePreference,
} from "@/lib/audio-input-device-preference";

export function MicrophonePreferences({
  open,
  onCaptureReady,
}: {
  open: boolean;
  onCaptureReady?: () => void;
}) {
  const [preferred, setPreferred] = useAudioInputDevicePreference();
  const { devices, refresh, isSupported, hasDeviceAccess } =
    useAudioInputDevices();
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isSupported) return;
    let disposed = false;
    let acquired: MediaStream | null = null;
    setError(null);
    setTestStream(null);
    void requestAudioInputStream(navigator.mediaDevices, preferred)
      .then((stream) => {
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = stream;
        setTestStream(stream);
        void refresh();
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Allow mic access in your settings."
            : "Can't open this mic. Choose another.",
        );
      });
    return () => {
      disposed = true;
      acquired?.getTracks().forEach((track) => track.stop());
      setTestStream(null);
    };
  }, [open, preferred, refresh, isSupported]);

  useEffect(() => {
    if (open && testStream) onCaptureReady?.();
  }, [open, testStream, onCaptureReady]);

  const stream = open ? testStream : null;
  const { silent } = useMicrophoneSignal(stream, false);
  const activeLabel = stream?.getAudioTracks()[0]?.label;
  const preferredMissing =
    hasDeviceAccess &&
    preferred !== null &&
    devices.length > 0 &&
    !devices.some((device) => device.deviceId === preferred);

  return (
    <div className="space-y-4">
      {open ? (
        <div
          className="space-y-2 rounded-lg border bg-muted/30 p-3"
          aria-label="Live microphone preview"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 font-medium">Live preview</span>
            <span className="min-w-0 truncate" title={activeLabel}>
              {error || !isSupported
                ? "Unavailable"
                : stream
                  ? activeLabel || "Listening"
                  : "Connecting…"}
            </span>
          </div>
          <WaveformVisualizer
            stream={stream}
            active={open && stream !== null}
            className="h-9 w-full"
          />
          <p role="status" className="min-h-5 text-sm text-muted-foreground">
            {error ??
              (!isSupported
                ? "This browser can't use a mic."
                : !stream
                  ? "Connecting to microphone…"
                  : silent
                    ? "No audio detected. Try another mic."
                    : "Speak to check your microphone.")}
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          Input device
        </p>
        <div
          role="group"
          aria-label="Microphone"
          className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-1"
        >
          {[
            { deviceId: null, label: "System default" },
            ...(preferredMissing
              ? [
                  {
                    deviceId: preferred,
                    label: "Preferred microphone (unavailable)",
                  },
                ]
              : []),
            ...devices,
          ].map((device) => (
            <button
              key={device.deviceId ?? "system"}
              type="button"
              aria-pressed={preferred === device.deviceId}
              disabled={preferredMissing && device.deviceId === preferred}
              onClick={() => setPreferred(device.deviceId)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50",
                preferred === device.deviceId && "bg-state-active",
              )}
            >
              <Icon
                name={device.deviceId === null ? "Laptop" : "Mic"}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 break-words">{device.label}</span>
              <span className="size-4 shrink-0" aria-hidden="true">
                {preferred === device.deviceId ? (
                  <Icon name="Check" className="size-4" />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
      {preferredMissing ? (
        <p className="text-xs text-muted-foreground">
          Preferred microphone unavailable. Using another input until it
          returns.
        </p>
      ) : null}
    </div>
  );
}
