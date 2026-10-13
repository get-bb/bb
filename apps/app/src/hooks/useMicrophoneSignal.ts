import { useEffect, useState } from "react";

export function useMicrophoneSignal(
  stream: MediaStream | null,
  reportLevel: boolean,
) {
  const [signal, setSignal] = useState({ level: 0, silent: false });

  useEffect(() => {
    setSignal({ level: 0, silent: false });
    if (!stream || typeof AudioContext === "undefined") return;
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
  }, [stream, reportLevel]);

  return signal;
}
