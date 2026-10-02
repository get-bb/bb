import { useCallback, useRef, useState } from "react";
import {
  hexToOklch,
  oklchToHex,
  relativeLuminance,
  type OklchColor,
} from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";

const HUE_SLOTS = 24;
const CHROMA_STOPS = [0, 0.04, 0.08, 0.12, 0.16, 0.2] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readableTextOn(hex: string): string {
  return relativeLuminance(hexToOklch(hex)) > 0.35 ? "#000000" : "#ffffff";
}

interface SaturationFieldProps {
  color: OklchColor;
  lightness: number;
  onChange: (color: OklchColor) => void;
}

function SaturationField({ color, lightness, onChange }: SaturationFieldProps) {
  const ref = useRef<HTMLDivElement>(null);

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      onChange({
        lightness,
        chroma: x * 0.37,
        hueDegrees: color.hueDegrees,
      });
    },
    [color.hueDegrees, lightness, onChange],
  );

  const base = oklchToHex({ lightness, chroma: 0, hueDegrees: color.hueDegrees });
  const vivid = oklchToHex({
    lightness,
    chroma: 0.37,
    hueDegrees: color.hueDegrees,
  });

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and chroma"
      aria-valuemin={0}
      aria-valuemax={0.37}
      aria-valuenow={Number(color.chroma.toFixed(3))}
      aria-valuetext={`Chroma ${color.chroma.toFixed(3)}`}
      className="relative aspect-[4/3] w-full touch-none overflow-hidden rounded-md border"
      style={{
        background: `linear-gradient(to right, ${base}, ${vivid})`,
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) return;
        pick(event);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.02 : 0.005;
        if (event.key === "ArrowRight") {
          onChange({ ...color, chroma: clamp(color.chroma + step, 0, 0.37) });
        } else if (event.key === "ArrowLeft") {
          onChange({ ...color, chroma: clamp(color.chroma - step, 0, 0.37) });
        } else {
          return;
        }
        event.preventDefault();
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{
          left: `${clamp(color.chroma / 0.37, 0, 1) * 100}%`,
          top: "50%",
        }}
      />
    </div>
  );
}

export interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const color = hexToOklch(value);
  const [lightnessDraft, setLightnessDraft] = useState(color.lightness);

  const emit = useCallback(
    (next: OklchColor) => onChange(oklchToHex(next)),
    [onChange],
  );

  const hex = oklchToHex(color);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${label} color`}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-accent"
        onClick={() => {
          setLightnessDraft(color.lightness);
          setOpen((previous) => !previous);
        }}
      >
        <span
          aria-hidden
          className="size-5 shrink-0 rounded-sm border"
          style={{ background: hex }}
        />
        <span className="min-w-0 flex-1 truncate text-2xs">{label}</span>
        <span className="font-mono text-2xs text-muted-foreground">{hex}</span>
      </button>

      {open ? (
        <div
          className={cn(
            "absolute right-0 z-50 mt-1 w-64 space-y-3 rounded-md border bg-popover p-3 shadow-md",
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <SaturationField
            color={color}
            lightness={lightnessDraft}
            onChange={emit}
          />

          <div className="space-y-1.5">
            <span className="text-2xs text-muted-foreground">Hue</span>
            <div className="flex gap-0.5">
              {Array.from({ length: HUE_SLOTS }, (_, index) => {
                const hue = (index / HUE_SLOTS) * 360;
                return (
                  <button
                    key={hue}
                    type="button"
                    aria-label={`Hue ${Math.round(hue)}`}
                    className="h-5 flex-1 rounded-sm border-2"
                    style={{
                      background: oklchToHex({
                        lightness: lightnessDraft,
                        chroma: Math.max(color.chroma, 0.12),
                        hueDegrees: hue,
                      }),
                      borderColor:
                        Math.abs(hue - color.hueDegrees) < 360 / HUE_SLOTS
                          ? "currentColor"
                          : "transparent",
                    }}
                    onClick={() =>
                      emit({ ...color, hueDegrees: hue, lightness: lightnessDraft })
                    }
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-2xs">
              <span className="w-14 text-muted-foreground">Lightness</span>
              <input
                type="range"
                min={0.05}
                max={0.99}
                step={0.01}
                value={lightnessDraft}
                className="flex-1"
                onChange={(event) => {
                  const lightness = Number(event.target.value);
                  setLightnessDraft(lightness);
                  emit({ ...color, lightness });
                }}
              />
              <span className="w-8 font-mono text-muted-foreground">
                {lightnessDraft.toFixed(2)}
              </span>
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="text-2xs text-muted-foreground">Chroma steps</span>
            <div className="flex gap-1">
              {CHROMA_STOPS.map((chroma) => (
                <button
                  key={chroma}
                  type="button"
                  aria-label={`Chroma ${chroma}`}
                  className="h-5 flex-1 rounded-sm border"
                  style={{
                    background: oklchToHex({
                      lightness: lightnessDraft,
                      chroma,
                      hueDegrees: color.hueDegrees,
                    }),
                  }}
                  onClick={() =>
                    emit({ ...color, chroma, lightness: lightnessDraft })
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex-1 truncate rounded-sm border px-2 py-1 font-mono text-2xs">
              <span style={{ color: readableTextOn(hex) }}>{hex}</span>
            </span>
            <button
              type="button"
              className="rounded-sm border px-2 py-1 text-2xs hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
