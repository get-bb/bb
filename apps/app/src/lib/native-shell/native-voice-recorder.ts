import { z } from "zod";
import { getNativeShell, type NativeShell } from "./native-shell";

const recordingSchema = z.object({
  base64: z.string(),
  mimeType: z.string().min(1),
});

function decodeBase64(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export class NativeVoiceRecorder {
  state: RecordingState = "inactive";
  mimeType = "";
  onstart: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly shell: NativeShell) {}

  async start(): Promise<void> {
    await this.shell.request("voice-start", {});
    this.state = "recording";
    this.onstart?.();
  }

  stop(): void {
    if (this.state !== "recording") return;
    this.state = "inactive";
    void this.shell
      .request("voice-stop", {})
      .then((result) => {
        const recording = recordingSchema.parse(result);
        this.mimeType = recording.mimeType;
        this.ondataavailable?.({
          data: decodeBase64(recording.base64, recording.mimeType),
        });
      })
      .catch(() => undefined)
      .finally(() => this.onstop?.());
  }
}

export function nativeVoiceShell(): NativeShell | null {
  const shell = getNativeShell();
  return shell?.handshake.voiceRecording === true ? shell : null;
}
