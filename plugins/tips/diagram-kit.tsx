import type { CSSProperties, ReactNode } from "react";

export const GRID = 48;
export const STROKE = 1.1;
export const WASH = 0.1;
export const SOFT = 0.4;
export const CANVAS = "var(--canvas)";

export const LINE = {
  stroke: "currentColor",
  strokeWidth: STROKE,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

export const HOVER_ANIMATIONS = [
  "fill-in",
  "flip-on",
  "flip-off",
  "glide",
  "slide-in",
  "fade-in",
  "pop",
  "press",
  "sweep",
  "grow",
  "snap",
  "twinkle",
  "nudge",
  "spin",
  "rise",
  "travel",
] as const;

export type HoverAnimation = (typeof HOVER_ANIMATIONS)[number];
export type Stagger = 0 | 1 | 2 | 3 | 4;

export interface Animated {
  animate?: HoverAnimation;
  stagger?: Stagger;
  from?: number | string;
  origin?: string;
}

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const ACTIVE =
  "[data-tip-art-trigger]:is(:hover, :focus-visible, :has(:focus-visible)) .tip-art";
const TRANSITIONS: readonly HoverAnimation[] = [
  "fill-in",
  "flip-on",
  "flip-off",
  "glide",
];
const KEYFRAMES: Partial<Record<HoverAnimation, string>> = {
  "slide-in":
    "from { transform: translateX(8px); opacity: 0; } to { transform: none; opacity: 1; }",
  "fade-in":
    "from { transform: translateY(2px); opacity: 0; } to { transform: none; opacity: 1; }",
  pop: "0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: none; }",
  press:
    "0%, 100% { transform: none; } 40% { transform: translateY(1.5px) scale(0.92); }",
  sweep:
    "0% { transform: translate(-10px, -14px); } 55% { transform: translate(-4px, -4px); } 100% { transform: none; }",
  grow: "from { transform: scaleY(0.2); } to { transform: none; }",
  snap: "from { transform: translate(7px, -7px) rotate(-25deg); opacity: 0.3; } to { transform: none; opacity: 1; }",
  twinkle:
    "0% { transform: none; } 45% { transform: scale(1.45) rotate(30deg); } 100% { transform: none; }",
  nudge: "0%, 100% { transform: none; } 45% { transform: translateX(3px); }",
  spin: "from { transform: rotate(0deg); } to { transform: rotate(360deg); }",
  rise: "from { transform: translateY(6px); } to { transform: none; }",
  travel: "from { transform: translate(10px, 8px); } to { transform: none; }",
};
const DURATIONS: Partial<Record<HoverAnimation, string>> = {
  press: "0.5s",
  "fade-in": "0.6s",
  sweep: "1.1s",
  spin: "1.2s",
};

const DIAGRAM_KIT_CSS = [
  `.tip-art [data-tip-part] { transform-box: fill-box; transform-origin: center; }`,
  `.tip-art :is(${TRANSITIONS.map((name) => `[data-tip-part="${name}"]`).join(", ")}) { transition: transform 0.8s ${EASE}, opacity 0.6s ${EASE}; }`,
  `${ACTIVE} :is([data-tip-part="fill-in"], [data-tip-part="flip-on"], [data-tip-part="glide"]) { transform: none !important; opacity: 1 !important; }`,
  `${ACTIVE} [data-tip-part="flip-off"] { opacity: 0; }`,
  ...HOVER_ANIMATIONS.flatMap((name) => {
    const frames = KEYFRAMES[name];
    if (frames === undefined) return [];
    return [
      `${ACTIVE} [data-tip-part="${name}"] { animation: tip-art-${name} ${DURATIONS[name] ?? "0.9s"} ${EASE} both; }\n@keyframes tip-art-${name} { ${frames} }`,
    ];
  }),
  ...[1, 2, 3, 4].map(
    (step) =>
      `${ACTIVE} [data-tip-stagger="${step}"] { animation-delay: ${step * 0.12}s; transition-delay: ${step * 0.12}s; }`,
  ),
  `@media (prefers-reduced-motion: reduce) { .tip-art [data-tip-part] { animation: none !important; transition: none !important; } }`,
].join("\n");

export function DiagramKitStyles() {
  return <style>{DIAGRAM_KIT_CSS}</style>;
}

function restStyle({
  animate,
  from,
  origin,
}: Animated): CSSProperties | undefined {
  switch (animate) {
    case undefined:
      return undefined;
    case "fill-in":
      return {
        transform: `scaleX(${typeof from === "number" ? from : 0})`,
        transformOrigin: origin ?? "left",
      };
    case "glide":
      return {
        transform: typeof from === "string" ? from : undefined,
        transformOrigin: origin,
      };
    case "flip-on":
      return {
        opacity: 0,
        transform: typeof from === "string" ? from : undefined,
        transformOrigin: origin,
      };
    case "grow":
      return { transformOrigin: origin ?? "bottom" };
    case "spin":
      return { transformBox: "view-box", transformOrigin: origin };
    default:
      return origin === undefined ? undefined : { transformOrigin: origin };
  }
}

export function Part({
  children,
  ...animated
}: Animated & { children: ReactNode }) {
  if (animated.animate === undefined) return <>{children}</>;
  return (
    <g
      data-tip-part={animated.animate}
      data-tip-stagger={animated.stagger ?? 0}
      style={restStyle(animated)}
    >
      {children}
    </g>
  );
}

export function Dot({
  cx,
  cy,
  r = 1.75,
  color = "currentColor",
  ...animated
}: Animated & { cx: number; cy: number; r?: number; color?: string }) {
  return (
    <Part {...animated}>
      <circle cx={cx} cy={cy} r={r} style={{ fill: color }} />
    </Part>
  );
}

export function Rule({
  x,
  y,
  width,
  soft = false,
  ...animated
}: Animated & { x: number; y: number; width: number; soft?: boolean }) {
  return (
    <Part {...animated}>
      <line
        {...LINE}
        strokeOpacity={soft ? SOFT : 1}
        x1={x}
        y1={y}
        x2={x + width}
        y2={y}
      />
    </Part>
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
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  soft?: boolean;
  dot?: number;
  dotColor?: string;
  gap?: number;
}) {
  return (
    <Part {...animated}>
      <Dot cx={x} cy={y} r={dot} color={dotColor} />
      <Rule x={x + gap} y={y} width={width} soft={soft} />
    </Part>
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
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  soft?: boolean;
  fill?: number;
}) {
  return (
    <Part {...animated}>
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
      />
    </Part>
  );
}

export function Window({
  x,
  y,
  width,
  height,
  bar = 6,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height: number;
  bar?: number;
}) {
  return (
    <Part {...animated}>
      <Panel x={x} y={y} width={width} height={height} />
      <Rule x={x} y={y + bar} width={width} soft />
      <Dot cx={x + 4} cy={y + bar / 2} r={1} />
      <Dot cx={x + 7.5} cy={y + bar / 2} r={1} />
    </Part>
  );
}

export function Node({
  cx,
  cy,
  r = 4.5,
  ...animated
}: Animated & { cx: number; cy: number; r?: number }) {
  return (
    <Part {...animated}>
      <circle
        {...LINE}
        cx={cx}
        cy={cy}
        r={r}
        fill="currentColor"
        fillOpacity={0.18}
      />
    </Part>
  );
}

export function Branch({
  start,
  end,
  ...animated
}: Animated & {
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
  return (
    <Part {...animated}>
      <path {...LINE} d={d} />
    </Part>
  );
}

export function ProgressBar({
  x,
  y,
  width,
  value,
  color,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  value: number;
  color?: string;
}) {
  const fillWidth = width - 2;
  const filled = animated.animate === "fill-in" ? fillWidth : fillWidth * value;
  return (
    <g>
      <rect
        {...LINE}
        x={x}
        y={y - 3}
        width={width}
        height={6}
        rx={3}
        fill="currentColor"
        fillOpacity={WASH}
      />
      <Part {...animated} from={animated.from ?? value}>
        <rect
          x={x + 1}
          y={y - 2}
          width={filled}
          height={4}
          rx={2}
          fill="currentColor"
          fillOpacity={color === undefined ? 0.55 : 1}
          style={color === undefined ? undefined : { color }}
        />
      </Part>
    </g>
  );
}

export function Toggle({
  x,
  y,
  on,
  ...animated
}: Animated & { x: number; y: number; on: boolean }) {
  const onState = (
    <>
      <rect
        x={x}
        y={y}
        width={10}
        height={6}
        rx={3}
        fill="currentColor"
        fillOpacity={0.85}
      />
      <circle cx={x + 7} cy={y + 3} r={2} style={{ fill: CANVAS }} />
    </>
  );
  if (on) return <Part {...animated}>{onState}</Part>;
  return (
    <g>
      <rect {...LINE} x={x} y={y} width={10} height={6} rx={3} />
      <Part
        animate={animated.animate === "flip-on" ? "flip-off" : undefined}
        stagger={animated.stagger}
      >
        <circle {...LINE} cx={x + 3} cy={y + 3} r={1.5} />
      </Part>
      {animated.animate === "flip-on" ? (
        <Part {...animated}>{onState}</Part>
      ) : null}
    </g>
  );
}

export function Slider({
  x,
  y,
  width,
  knob,
  to,
  color,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  knob: number;
  to?: number;
  color: string;
}) {
  const gliding = animated.animate === "glide" && to !== undefined;
  const end = gliding ? to : knob;
  return (
    <g>
      <Rule x={x} y={y} width={width} soft />
      <Part
        animate={gliding ? "fill-in" : undefined}
        from={(knob - 1 - x) / (end - 1 - x)}
        stagger={animated.stagger}
      >
        <Rule x={x} y={y} width={end - 1 - x} />
      </Part>
      <Part
        animate={gliding ? "glide" : undefined}
        from={`translateX(${knob - end}px)`}
        stagger={animated.stagger}
      >
        <circle cx={end} cy={y} r={3} style={{ fill: color }} />
      </Part>
    </g>
  );
}

export function Button({
  x,
  y,
  width,
  height = 10,
  color,
  label = true,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height?: number;
  color?: string;
  label?: boolean;
}) {
  return (
    <Part {...animated}>
      {color === undefined ? (
        <rect {...LINE} x={x} y={y} width={width} height={height} rx={3} />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={3}
          strokeWidth={STROKE}
          fillOpacity={0.18}
          style={{ stroke: color, fill: color }}
        />
      )}
      {label && color === undefined ? (
        <Rule x={x + width / 2 - 4} y={y + height / 2} width={8} soft />
      ) : null}
    </Part>
  );
}

export function CheckMark({
  x,
  y,
  color,
  ...animated
}: Animated & { x: number; y: number; color: string }) {
  return (
    <Part {...animated}>
      <path {...LINE} d={`M${x} ${y}l2 2 4-4.5`} style={{ stroke: color }} />
    </Part>
  );
}

export function Check({
  cx,
  cy,
  r = 5.5,
  color,
  ...animated
}: Animated & { cx: number; cy: number; r?: number; color: string }) {
  return (
    <Part {...animated}>
      <circle cx={cx} cy={cy} r={r} style={{ fill: color }} />
      <path
        d={`M${cx - 2.5} ${cy}l1.8 1.8 3.2-3.4`}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ stroke: CANVAS }}
      />
    </Part>
  );
}

export function Cursor({
  x,
  y,
  ...animated
}: Animated & { x: number; y: number }) {
  return (
    <Part {...animated}>
      <path
        {...LINE}
        fill="currentColor"
        d={`M${x} ${y}v8.5l2.2-2 1.6 3.3 1.3-.6-1.6-3.2h3Z`}
      />
    </Part>
  );
}

export function Phone({
  x,
  y,
  width = 20,
  height = 40,
  ...animated
}: Animated & { x: number; y: number; width?: number; height?: number }) {
  return (
    <Part {...animated}>
      <Panel x={x} y={y} width={width} height={height} rx={4.5} />
      <Rule x={x + width / 2 - 2.5} y={y + 4} width={5} soft />
      <Rule x={x + width / 2 - 3} y={y + height - 4.5} width={6} />
    </Part>
  );
}

export function Envelope({
  x,
  y,
  width,
  height,
  ...animated
}: Animated & { x: number; y: number; width: number; height: number }) {
  const bottom = y + height;
  return (
    <Part {...animated}>
      <path
        {...LINE}
        style={{ fill: CANVAS }}
        d={`M${x} ${y}h${width}V${bottom - 2}a2 2 0 0 1-2 2H${x + 2}a2 2 0 0 1-2-2Z`}
      />
      <path {...LINE} d={`M${x} ${y + 0.5}l${width / 2} 11 ${width / 2}-11`} />
    </Part>
  );
}

export function Keycap({
  x,
  y,
  width = 13,
  height = 10,
  label,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: string;
}) {
  return (
    <Part {...animated}>
      <rect
        {...LINE}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        style={{ fill: CANVAS }}
      />
      <text
        x={x + width / 2}
        y={y + height * 0.74}
        fontSize={7}
        fontWeight={600}
        textAnchor="middle"
        fill="currentColor"
        fontFamily="inherit"
      >
        {label}
      </text>
    </Part>
  );
}

export function SearchGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle {...LINE} cx={cx} cy={cy} r={2.5} />
      <path {...LINE} d={`M${cx + 1.8} ${cy + 1.8}l1.7 1.7`} />
    </g>
  );
}

export function Magnifier({
  cx,
  cy,
  r = 9,
  children,
  ...animated
}: Animated & { cx: number; cy: number; r?: number; children?: ReactNode }) {
  return (
    <Part {...animated}>
      <circle {...LINE} cx={cx} cy={cy} r={r} style={{ fill: CANVAS }} />
      {children}
      <path
        {...LINE}
        strokeWidth={2}
        d={`M${cx + r * 0.72} ${cy + r * 0.72}l6 6`}
      />
    </Part>
  );
}

export function ChartAxes({
  x,
  y,
  width,
  height,
  limit,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  limit?: number;
}) {
  return (
    <g>
      <path {...LINE} d={`M${x} ${y}v${height}h${width}`} />
      {limit === undefined ? null : (
        <path
          {...LINE}
          strokeOpacity={SOFT}
          strokeDasharray="2.5 2.5"
          d={`M${x} ${limit}h${width}`}
        />
      )}
    </g>
  );
}

export function Bar({
  x,
  baseline,
  height,
  width = 5,
  color,
  ...animated
}: Animated & {
  x: number;
  baseline: number;
  height: number;
  width?: number;
  color?: string;
}) {
  return (
    <Part {...animated}>
      <rect
        x={x}
        y={baseline - height}
        width={width}
        height={height}
        rx={1.5}
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="currentColor"
        fillOpacity={color === undefined ? WASH * 1.6 : 0.25}
        style={color === undefined ? undefined : { color }}
      />
    </Part>
  );
}

export function CardStack({
  x,
  y,
  width,
  height,
  offset = 6,
  children,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height: number;
  offset?: number;
  children?: ReactNode;
}) {
  return (
    <Part {...animated}>
      <Panel x={x + offset} y={y - offset} width={width} height={height} soft />
      <Panel x={x} y={y} width={width} height={height} />
      {children}
    </Part>
  );
}

export function Arrow({
  d,
  head,
  color,
  ...animated
}: Animated & { d: string; head: string; color: string }) {
  return (
    <g>
      <path {...LINE} d={d} />
      <Part {...animated}>
        <path {...LINE} d={head} style={{ stroke: color }} />
      </Part>
    </g>
  );
}

export function Sparkle({
  cx,
  cy,
  size = 4.5,
  color,
  ...animated
}: Animated & { cx: number; cy: number; size?: number; color: string }) {
  const f = size / 4.5;
  const n = (value: number) => Number((value * f).toFixed(3));
  return (
    <Part {...animated}>
      <path
        d={`M${cx} ${cy - n(4.5)}c${n(0.5)} ${n(3)} ${n(1.5)} ${n(4)} ${n(4.5)} ${n(4.5)}c${n(-3)} ${n(0.5)} ${n(-4)} ${n(1.5)} ${n(-4.5)} ${n(4.5)}c${n(-0.5)} ${n(-3)} ${n(-1.5)} ${n(-4)} ${n(-4.5)} ${n(-4.5)}c${n(3)} ${n(-0.5)} ${n(4)} ${n(-1.5)} ${n(4.5)} ${n(-4.5)}Z`}
        style={{ fill: color }}
      />
    </Part>
  );
}

export function Bubble({
  x,
  y,
  width,
  height,
  tail,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height: number;
  tail: readonly [start: number, width: number, height: number];
}) {
  const r = 4;
  const [start, tailWidth, tailHeight] = tail;
  return (
    <Part {...animated}>
      <path
        {...LINE}
        fill="currentColor"
        fillOpacity={WASH}
        d={`M${x + r} ${y}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1-${r} ${r}H${start}l-${tailWidth} ${tailHeight}v-${tailHeight}H${x + r}a${r} ${r} 0 0 1-${r}-${r}V${y + r}a${r} ${r} 0 0 1 ${r}-${r}Z`}
      />
    </Part>
  );
}

export function Clock({
  cx,
  cy,
  r = 8.5,
  color,
  ...animated
}: Animated & { cx: number; cy: number; r?: number; color: string }) {
  return (
    <g>
      <circle {...LINE} cx={cx} cy={cy} r={r} style={{ fill: CANVAS }} />
      <Part {...animated} origin={animated.origin ?? `${cx}px ${cy}px`}>
        <path
          {...LINE}
          d={`M${cx} ${cy - 4.5}V${cy}l3 2`}
          style={{ stroke: color }}
        />
      </Part>
    </g>
  );
}

export function CalendarGrid({
  x,
  y,
  width,
  height,
  columns = 4,
  rows = 2,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  columns?: number;
  rows?: number;
}) {
  return (
    <g>
      <Panel x={x} y={y} width={width} height={height} />
      <Rule x={x} y={y + 7} width={width} soft />
      <path {...LINE} d={`M${x + 7} ${y - 3}v6M${x + width - 7} ${y - 3}v6`} />
      {Array.from({ length: columns }, (_, column) =>
        Array.from({ length: rows }, (_, row) => (
          <Dot
            key={`${column}-${row}`}
            cx={x + 6 + column * 6}
            cy={y + 13 + row * 6}
            r={1.25}
          />
        )),
      )}
    </g>
  );
}

export function Wrench({
  x,
  y,
  color,
  ...animated
}: Animated & { x: number; y: number; color: string }) {
  return (
    <Part {...animated}>
      <g transform={`translate(${x} ${y})`}>
        <path
          {...LINE}
          strokeWidth={1.3}
          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          style={{ stroke: color, fill: CANVAS }}
        />
      </g>
    </Part>
  );
}

export function Pill({
  x,
  y,
  width,
  height,
  dashed = false,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height: number;
  dashed?: boolean;
}) {
  return (
    <Part {...animated}>
      <rect
        {...LINE}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={height / 2}
        strokeDasharray={dashed ? "3 2.5" : undefined}
      />
    </Part>
  );
}

export function Highlight({
  x,
  y,
  width,
  height,
  color,
  opacity = WASH * 1.5,
  ...animated
}: Animated & {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <Part {...animated}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill="currentColor"
        fillOpacity={opacity}
        style={color === undefined ? undefined : { color }}
      />
    </Part>
  );
}

export function Diagram({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${GRID} ${GRID}`}
      className="tip-art size-16 shrink-0"
      style={{ color: "color-mix(in oklch, var(--ink) 82%, var(--canvas))" }}
    >
      {children}
    </svg>
  );
}
