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
      peer.createDataChannel("oai-events");
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
