import type { ReactNode } from "react";

export const GRID = 48;
export const STROKE = 1.1;
export const WASH = 0.1;
export const SOFT = 0.4;
export const CANVAS = "var(--canvas)";
export const INK = "color-mix(in oklch, var(--ink) 82%, var(--canvas))";

export const LINE = {
  stroke: "currentColor",
  strokeWidth: STROKE,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

export function Dot({
  cx,
  cy,
  r = 1.75,
  color = "currentColor",
}: {
  cx: number;
  cy: number;
  r?: number;
  color?: string;
}) {
  return <circle cx={cx} cy={cy} r={r} style={{ fill: color }} />;
}

export function Rule({
  x,
  y,
  width,
  soft = false,
}: {
  x: number;
  y: number;
  width: number;
  soft?: boolean;
}) {
  return (
    <line
      {...LINE}
      strokeOpacity={soft ? SOFT : 1}
      x1={x}
      y1={y}
      x2={x + width}
      y2={y}
    />
  );
}

export function ListLine({
  x,
  y,
  width,
  soft = true,
  dot = 1.5,
  dotColor,
  gap = 4,
}: {
  x: number;
  y: number;
  width: number;
  soft?: boolean;
  dot?: number;
  dotColor?: string;
  gap?: number;
}) {
  return (
    <g>
      <Dot cx={x} cy={y} r={dot} color={dotColor} />
      <Rule x={x + gap} y={y} width={width} soft={soft} />
    </g>
  );
}

export function Panel({
  x,
  y,
  width,
  height,
  rx = 3,
  soft = false,
  fill = WASH,
  dashed = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  soft?: boolean;
  fill?: number;
  dashed?: boolean;
}) {
  return (
    <rect
      {...LINE}
      x={x}
      y={y}
      width={width}
      height={height}
      rx={rx}
      fill="currentColor"
      fillOpacity={fill}
      strokeOpacity={soft ? SOFT : 1}
      strokeDasharray={dashed ? "3 2.5" : undefined}
    />
  );
}

export function Window({
  x,
  y,
  width,
  height,
  bar = 6,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  bar?: number;
}) {
  return (
    <g>
      <Panel x={x} y={y} width={width} height={height} />
      <Rule x={x} y={y + bar} width={width} soft />
      <Dot cx={x + 4} cy={y + bar / 2} r={1} />
      <Dot cx={x + 7.5} cy={y + bar / 2} r={1} />
    </g>
  );
}

export function Node({
  cx,
  cy,
  r = 4.5,
  color,
}: {
  cx: number;
  cy: number;
  r?: number;
  color?: string;
}) {
  return (
    <circle
      {...LINE}
      cx={cx}
      cy={cy}
      r={r}
      fill="currentColor"
      fillOpacity={0.18}
      style={color === undefined ? undefined : { color }}
    />
  );
}

export function Branch({
  start,
  end,
}: {
  start: readonly [number, number];
  end: readonly [number, number];
}) {
  const [x1, y1] = start;
  const [x2, y2] = end;
  const mid = (x1 + x2) / 2;
  const d =
    y1 === y2
      ? `M${x1} ${y1}H${x2}`
      : `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  return <path {...LINE} d={d} />;
}

export function Phone({
  x,
  y,
  width = 20,
  height = 40,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
}) {
  return (
    <g>
      <Panel x={x} y={y} width={width} height={height} rx={4.5} />
      <Rule x={x + width / 2 - 2.5} y={y + 4} width={5} soft />
      <Rule x={x + width / 2 - 3} y={y + height - 4.5} width={6} />
    </g>
  );
}

export function CardStack({
  x,
  y,
  width,
  height,
  offset = 6,
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  offset?: number;
  children?: ReactNode;
}) {
  return (
    <g>
      <Panel x={x + offset} y={y - offset} width={width} height={height} soft />
      <Panel x={x} y={y} width={width} height={height} />
      {children}
    </g>
  );
}

export function Sparkle({
  cx,
  cy,
  size = 4.5,
  color,
}: {
  cx: number;
  cy: number;
  size?: number;
  color: string;
}) {
  const f = size / 4.5;
  const n = (value: number) => Number((value * f).toFixed(3));
  return (
    <path
      d={`M${cx} ${cy - n(4.5)}c${n(0.5)} ${n(3)} ${n(1.5)} ${n(4)} ${n(4.5)} ${n(4.5)}c${n(-3)} ${n(0.5)} ${n(-4)} ${n(1.5)} ${n(-4.5)} ${n(4.5)}c${n(-0.5)} ${n(-3)} ${n(-1.5)} ${n(-4)} ${n(-4.5)} ${n(-4.5)}c${n(3)} ${n(-0.5)} ${n(4)} ${n(-1.5)} ${n(4.5)} ${n(-4.5)}Z`}
      style={{ fill: color }}
    />
  );
}

export function Bubble({
  x,
  y,
  width,
  height,
  tail,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  tail: readonly [start: number, width: number, height: number];
}) {
  const r = 4;
  const [start, tailWidth, tailHeight] = tail;
  return (
    <path
      {...LINE}
      fill="currentColor"
      fillOpacity={WASH}
      d={`M${x + r} ${y}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1-${r} ${r}H${start}l-${tailWidth} ${tailHeight}v-${tailHeight}H${x + r}a${r} ${r} 0 0 1-${r}-${r}V${y + r}a${r} ${r} 0 0 1 ${r}-${r}Z`}
    />
  );
}

export function Clock({
  cx,
  cy,
  r = 8.5,
  color,
}: {
  cx: number;
  cy: number;
  r?: number;
  color: string;
}) {
  return (
    <g>
      <circle {...LINE} cx={cx} cy={cy} r={r} style={{ fill: CANVAS }} />
      <path
        {...LINE}
        d={`M${cx} ${cy - 4.5}V${cy}l3 2`}
        style={{ stroke: color }}
      />
    </g>
  );
}

export function Wrench({
  x,
  y,
  color,
}: {
  x: number;
  y: number;
  color: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        {...LINE}
        strokeWidth={1.3}
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        style={{ stroke: color, fill: CANVAS }}
      />
    </g>
  );
}

export function Pill({
  x,
  y,
  width,
  height,
  color,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}) {
  return (
    <rect
      {...LINE}
      x={x}
      y={y}
      width={width}
      height={height}
      rx={height / 2}
      fill="currentColor"
      fillOpacity={color === undefined ? 0 : 0.18}
      style={color === undefined ? undefined : { color }}
    />
  );
}

export function Highlight({
  x,
  y,
  width,
  height,
  rx = 2,
  color,
  opacity = WASH * 1.5,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={rx}
      fill="currentColor"
      fillOpacity={opacity}
      style={color === undefined ? undefined : { color }}
    />
  );
}
