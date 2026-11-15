import { useEffect, useRef, useState } from "react";
import {
  experimental_useThreadExtensionState,
  useComposer,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VoiceClient } from "./voice-client.js";
import { voiceStateSchema } from "./voice-state.js";

function VoiceWaveform({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 10v4m5-9v14m5-11v8m5-6v4" />
    </svg>
  );
}

function VoiceChat({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const audio = useRef<HTMLAudioElement>(null);
  const client = useRef<VoiceClient | null>(null);
  const [status, setStatus] = useState<"connecting" | "active" | "closed">(
    "closed",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const state = voiceStateSchema.safeParse(
    experimental_useThreadExtensionState(threadId, "voice"),
  );
  const remoteSessionId = state.success ? state.data.sessionId : null;
  const remoteStatus = state.success ? state.data.status : null;
  const remoteMessage = state.success ? state.data.message : null;
  const remoteContext = state.success ? state.data.backgroundContext : null;

  useEffect(() => {
    const stop = () => {
      client.current?.stop();
      client.current = null;
    };
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [threadId]);
  useEffect(() => {
    if (remoteSessionId !== client.current?.sessionId) return;
    if (remoteStatus !== "active") client.current?.stop(remoteMessage);
    else if (remoteContext) client.current?.addBackgroundContext(remoteContext);
  }, [remoteSessionId, remoteStatus, remoteMessage, remoteContext]);

  const start = () => {
    if (!audio.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      setMessage(
        "Voice chat requires microphone access in a supported browser over HTTPS.",
      );
      return;
    }
    setMuted(false);
    setAudioBlocked(false);
    const next = new VoiceClient({
      audio: audio.current,
      mediaDevices: navigator.mediaDevices,
      createPeer: () => new RTCPeerConnection(),
      request: (command) => sdk.threads.voice({ threadId, command }),
      state: (nextStatus, error) => {
        setStatus(nextStatus);
        setMessage(error);
      },
      audioBlocked: () => setAudioBlocked(true),
    });
    client.current = next;
    void next.start();
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 text-xs">
      <audio ref={audio} autoPlay />
      {status === "closed" ? (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={`size-9 shrink-0 rounded-full ${message ? "text-destructive-text" : "text-muted-foreground hover:text-foreground"}`}
                aria-label="Start voice chat"
                onClick={start}
              >
                <VoiceWaveform className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {message ?? "Start voice chat"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <>
          <VoiceWaveform
            className={`size-4 shrink-0 ${status === "connecting" ? "animate-pulse" : ""}`}
          />
          <span role="status" className="sr-only">
            {status === "connecting"
              ? "Connecting voice…"
              : muted
                ? "Voice chat · microphone muted"
                : "Voice chat · listening"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={status !== "active"}
            aria-pressed={muted}
            onClick={() => {
              const next = !muted;
              client.current?.mute(next);
              setMuted(next);
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => client.current?.stop()}
          >
            End voice
          </Button>
        </>
      )}
      {audioBlocked && status !== "closed" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void audio.current
              ?.play()
              .then(() => setAudioBlocked(false))
              .catch(() =>
                setMessage(
                  "Allow audio playback in your browser to hear Codex.",
                ),
              );
          }}
        >
          Enable audio
        </Button>
      ) : null}
      {message ? (
        <p role="alert" className="sr-only">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function CodexVoiceAction() {
  const { scope, selection } = useComposer();
  return scope.kind === "thread" && selection?.providerId === "codex" ? (
    <VoiceChat key={scope.threadId} threadId={scope.threadId} />
  ) : null;
}
