import { z } from "zod";

export type VoiceRequest =
  | { action: "start"; sessionId: string; sdp: string }
  | { action: "keepAlive"; sessionId: string }
  | { action: "stop"; sessionId: string };

export interface VoiceClientOptions {
  request(command: VoiceRequest): Promise<{ sdp: string | null }>;
  audio: HTMLAudioElement;
  mediaDevices: Pick<MediaDevices, "getUserMedia">;
  createPeer(): RTCPeerConnection;
  state(
    status: "connecting" | "active" | "closed",
    message: string | null,
  ): void;
  audioBlocked(): void;
}

export class VoiceClient {
  readonly sessionId = crypto.randomUUID();
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private stopped = false;
  private channel: RTCDataChannel | null = null;
  private backgroundContext: string | null = null;
  private contextSent = false;
  private inputActive = false;
  private assistantActive = false;
  private contextPending = false;
  private requested = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private heartbeatPending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: VoiceClientOptions) {}

  async start(): Promise<void> {
    this.options.state("connecting", null);
    this.timer = setTimeout(
      () => this.stop("Voice connection timed out. Try again."),
      45000,
    );
    try {
      const stream = await this.options.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const peer = this.options.createPeer();
      this.peer = peer;
      stream.getTracks().forEach((track) => {
        peer.addTrack(track, stream);
        track.onended = () =>
          this.stop("Microphone disconnected. Start voice again to reconnect.");
      });
      peer.ontrack = (event) => {
        if (this.stopped) return;
        this.options.audio.srcObject = new MediaStream([event.track]);
        void this.options.audio.play().catch(() => this.options.audioBlocked());
      };
      peer.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (peer.connectionState === "connected") {
          clearTimeout(this.timer);
          clearTimeout(this.disconnectTimer);
          this.options.state("active", null);
        }
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        )
          this.stop("Voice connection ended. Start voice again to reconnect.");
        if (peer.connectionState === "disconnected") {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(
            () => this.stop("Voice connection was lost."),
            10000,
          );
        }
      };
      this.channel = peer.createDataChannel("oai-events");
      this.channel.onopen = () => this.flushBackgroundContext();
      this.channel.onmessage = (event) => {
        if (this.stopped) return;
        let value: unknown;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = z
          .object({
            type: z.string(),
            item: z.object({ text: z.string().optional() }).optional(),
            turn: z.object({ role: z.string().optional() }).optional(),
          })
          .safeParse(value);
        if (!parsed.success) return;
        if (
          parsed.data.type === "input_transcript.added" &&
          parsed.data.item?.text?.trim()
        ) {
          this.inputActive = true;
        }
        if (
          parsed.data.type === "output_transcript.added" ||
          (parsed.data.type === "turn.created" &&
            parsed.data.turn?.role === "assistant")
        )
          this.assistantActive = true;
        if (parsed.data.type === "turn.done") {
          if (parsed.data.turn?.role === "user") this.inputActive = false;
          if (parsed.data.turn?.role === "assistant") {
            this.assistantActive = false;
            this.flushBackgroundContext();
          }
        }
        if (parsed.data.type === "session.context.appended") {
          this.contextPending = false;
          this.flushBackgroundContext();
        }
      };
      const offer = await peer.createOffer();
      if (this.stopped) return;
      await peer.setLocalDescription(offer);
      if (this.stopped) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Could not create a voice connection");
      this.requested = true;
      const answer = await this.options.request({
        action: "start",
        sessionId: this.sessionId,
        sdp,
      });
      if (this.stopped) return;
      if (!answer.sdp)
        throw new Error("Codex did not return a voice connection");
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      if (this.stopped) return;
      this.heartbeat = setInterval(() => {
        if (this.heartbeatPending) return;
        this.heartbeatPending = true;
        void this.options
          .request({ action: "keepAlive", sessionId: this.sessionId })
          .catch(() =>
            this.stop(
              "Voice session was lost. Start voice again to reconnect.",
            ),
          )
          .finally(() => {
            this.heartbeatPending = false;
          });
      }, 15000);
    } catch (error) {
      if (!this.stopped)
        this.stop(
          error instanceof Error ? error.message : "Could not start voice chat",
        );
    }
  }

  addBackgroundContext(text: string): void {
    if (this.stopped || this.contextSent || this.backgroundContext || !text)
      return;
    this.backgroundContext = text;
    this.flushBackgroundContext();
  }

  private flushBackgroundContext(): void {
    if (
      this.stopped ||
      this.contextSent ||
      this.contextPending ||
      this.inputActive ||
      this.assistantActive ||
      !this.backgroundContext ||
      this.channel?.readyState !== "open"
    )
      return;
    const encoder = new TextEncoder();
    let chunk = "";
    let bytes = 0;
    for (const character of this.backgroundContext) {
      const length = encoder.encode(character).length;
      if (bytes + length > 500) break;
      chunk += character;
      bytes += length;
    }
    try {
      this.contextPending = true;
      this.channel.send(
        JSON.stringify({
          type: "session.context.append",
          channel: "developer",
          content: [{ type: "input_text", text: chunk }],
        }),
      );
      this.backgroundContext = this.backgroundContext.slice(chunk.length);
      if (!this.backgroundContext) {
        this.contextSent = true;
        this.backgroundContext = null;
      }
    } catch {
      this.contextSent = true;
      this.backgroundContext = null;
      this.options.state(
        "active",
        "Background context could not be delivered. Voice can still consult the coding agent.",
      );
    }
  }

  mute(muted: boolean): void {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  stop(message: string | null = null): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    clearTimeout(this.disconnectTimer);
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;
    this.backgroundContext = null;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
      this.peer = null;
    }
    this.options.audio.pause();
    this.options.audio.srcObject = null;
    this.options.state("closed", message);
    if (this.requested)
      void this.options
        .request({ action: "stop", sessionId: this.sessionId })
        .catch(() => {});
  }
}
