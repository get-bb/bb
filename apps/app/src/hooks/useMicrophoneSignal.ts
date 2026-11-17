import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

interface MicrophoneSignal {
  level: number;
  silent: boolean;
}

const INITIAL_MICROPHONE_SIGNAL: MicrophoneSignal = { level: 0, silent: false };

function monitorMicrophoneSignal(
  stream: MediaStream,
  reportLevel: boolean,
  setSignal: Dispatch<SetStateAction<MicrophoneSignal>>,
): (() => void) | undefined {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
  } catch {
    void context.close().catch(() => {});
    return;
  }
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let lastSignalAt = performance.now();
  void context.resume().catch(() => {});
  const timer = window.setInterval(() => {
    if (context.state !== "running") {
      lastSignalAt = performance.now();
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length);
    const now = performance.now();
    if (rms > 0.00002) lastSignalAt = now;
    const silent = now - lastSignalAt >= 5000;
    const level = reportLevel ? Math.min(1, rms * 12) : 0;
    setSignal((previous) =>
      previous.silent === silent && previous.level === level
        ? previous
        : { level, silent },
    );
  }, 100);
  return () => {
    window.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    void context.close().catch(() => {});
  };
}

export function useMicrophoneSignal(
  stream: MediaStream | null,
  reportLevel: boolean,
) {
  const [signal, setSignal] = useState(INITIAL_MICROPHONE_SIGNAL);
  const [signalSource, setSignalSource] = useState({ stream, reportLevel });
  if (
    signalSource.stream !== stream ||
    signalSource.reportLevel !== reportLevel
  ) {
    setSignalSource({ stream, reportLevel });
    setSignal(INITIAL_MICROPHONE_SIGNAL);
  }

  useEffect(() => {
    if (!stream || typeof AudioContext === "undefined") return;
    return monitorMicrophoneSignal(stream, reportLevel, setSignal);
  }, [stream, reportLevel]);

  return signal;
}
