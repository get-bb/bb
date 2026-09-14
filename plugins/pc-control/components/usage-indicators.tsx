import { formatPercent } from "./format.js";
import {
  levelStrokeClass,
  loadLevel,
} from "./load-thresholds.js";

function toneClass(percent: number): string {
  return levelStrokeClass(loadLevel(percent));
}

export interface UsageRingProps {
  label: string;
  percent: number | null;
  detail: string;
  "data-testid"?: string;
}

export function UsageRing({
  label,
  percent,
  detail,
  ...rest
}: UsageRingProps) {
  const size = 84;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped =
    percent === null
      ? 0
      : Math.min(100, Math.max(0, percent));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div
      className="flex w-24 shrink-0 flex-col items-center gap-1"
      data-testid={rest["data-testid"]}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label}: ${formatPercent(percent)}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`transition-[stroke-dashoffset] duration-500 ${
              percent === null ? "stroke-muted-foreground/40" : toneClass(clamped)
            }`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
          {formatPercent(percent)}
        </span>
      </div>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span
        className="w-full truncate text-center text-[11px] text-muted-foreground"
        title={detail}
      >
        {detail}
      </span>
    </div>
  );
}
