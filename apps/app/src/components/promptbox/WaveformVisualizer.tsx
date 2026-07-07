import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface WaveformVisualizerProps {
  stream: MediaStream | null;
  active: boolean;
  className?: string;
}

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;
const SAMPLE_EVERY_N_FRAMES = 2;
const NOISE_FLOOR = 0.006;
const AMPLITUDE_GAIN = 8;
const AMPLITUDE_GAMMA = 0.6;
const IDLE_AMPLITUDE = 0.06;

export function WaveformVisualizer({
  stream,
  active,
  className,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let color = "currentColor";
    let cssWidth = 0;
    let cssHeight = 0;
    let barCount = Math.max(1, Math.floor(cssWidth / BAR_PITCH));

    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(canvas).color || color;
      barCount = Math.max(1, Math.floor(cssWidth / BAR_PITCH));
      if (barsRef.current.length > barCount) {
        barsRef.current = barsRef.current.slice(
          barsRef.current.length - barCount,
        );
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineWidth = BAR_WIDTH;
      const bars = barsRef.current;
      const midY = cssHeight / 2;
      const maxHalf = Math.max(0, (cssHeight * 0.95 - BAR_WIDTH) / 2);
      const edgeFade = cssWidth * 0.15;
      for (let i = 0; i < bars.length; i++) {
        const amp = bars[bars.length - 1 - i];
        const cx = cssWidth - BAR_WIDTH / 2 - i * BAR_PITCH;
        if (cx + BAR_WIDTH < 0) break;
        const half = amp * maxHalf;
        ctx.globalAlpha = cx < edgeFade ? Math.max(0.15, cx / edgeFade) : 1;
        ctx.beginPath();
        ctx.moveTo(cx, midY - half);
        ctx.lineTo(cx, midY + half);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    measure();

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const audioTrack = stream?.getAudioTracks()[0] ?? null;
    const canAnimate =
      active &&
      audioTrack !== null &&
      typeof window.AudioContext !== "undefined" &&
      !prefersReducedMotion;

    if (!canAnimate || audioTrack === null) {
      if (barsRef.current.length === 0) {
        barsRef.current = Array.from(
          { length: barCount },
          () => IDLE_AMPLITUDE,
        );
      }
      draw();
      if (typeof ResizeObserver === "undefined") {
        return;
      }
      const observer = new ResizeObserver(() => {
        measure();
        draw();
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    }

    const audioCtx = new AudioContext();
    void audioCtx.resume();
    // Some mobile browsers feed silence to WebAudio when MediaRecorder owns the original track.
    const analysisTrack = audioTrack.clone();
    const source = audioCtx.createMediaStreamSource(
      new MediaStream([analysisTrack]),
    );
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const timeData = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let rafId = 0;

    const tick = () => {
      if (audioCtx.state === "suspended") void audioCtx.resume();
      if (frame % SAMPLE_EVERY_N_FRAMES === 0) {
        analyser.getByteTimeDomainData(timeData);
        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
          const centered = (timeData[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / timeData.length);
        const boosted = Math.max(0, rms - NOISE_FLOOR) * AMPLITUDE_GAIN;
        const amp = Math.min(1, boosted ** AMPLITUDE_GAMMA);
        const bars = barsRef.current;
        bars.push(amp);
        if (bars.length > barCount) bars.shift();
      }
      frame++;
      draw();
      rafId = requestAnimationFrame(tick);
    };

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    observer?.observe(canvas);
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      source.disconnect();
      analyser.disconnect();
      analysisTrack.stop();
      void audioCtx.close();
    };
  }, [stream, active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block h-full w-full text-foreground", className)}
    />
  );
}
